import { config } from 'dotenv';
import { Network, IndexerClient, CompositeClient, BECH32_PREFIX, LocalWallet, OrderFlags, SubaccountClient, OrderSide, OrderType, OrderExecution, OrderTimeInForce } from '@dydxprotocol/v4-client-js';
import { Bollinger } from './bollinger';

export interface IPNLHistory {
    market: string
    pnls: number[]
}

export enum EAdvice {
    INCREASE = "INCREASE",
    DECREASE = "DECREASE",
    CELEBRATE = "CELEBRATE",
    PREPARE = "PREPARE",
    RELAX = "RELAX"
}

export class Collector {

    private static instance: Collector
    public static getInstance(address: string, mnemonic: string, compositeClient: any): Collector {
        if (Collector.instance === undefined) {
            Collector.instance = new Collector(address, mnemonic, compositeClient)
        }
        return Collector.instance
    }

    private historyLength = 60
    private celebrateAt = 1
    private intervalLength = 6
    private targetCollateralPercentage = 30
    private minCollateralPercentage = 20
    private stepSizeFactor = 6
    private spreadFactor = 9
    private roundCounter = 0
    private freeCollateralPercentage = 0
    private pnlHistories: IPNLHistory[] = []
    private address
    private mnemonic
    private indexerClient
    private compositeClient

    private constructor(address: string, mnemonic: string, compositeClient: any) {
        this.address = address
        this.mnemonic = mnemonic
        this.indexerClient = new IndexerClient(Network.mainnet().indexerConfig)
        this.compositeClient = compositeClient
    }

    public prepare(hL: number, cAt: number, iL: number, tCP: number, mCP: number, sSF: number, sF: number) {
        this.historyLength = hL
        this.celebrateAt = cAt
        this.intervalLength = iL
        this.targetCollateralPercentage = tCP
        this.minCollateralPercentage = mCP
        this.stepSizeFactor = sSF
        this.spreadFactor = sF
    }

    public play() {
        if (this.intervalLength === undefined || this.intervalLength < 9) {
            throw new Error(`interval length shall be at least 9 seconds`)
        }
        setInterval(async () => {
            try {
                await this.playRound()
            } catch (error: any) {
                console.log(error.message);
            }
        }, this.intervalLength * 1000)
    }

    private async playRound() {
        this.roundCounter++
        await this.considerAccount()
        await this.considerPositions()
    }

    private async considerAccount() {
        let response = await this.indexerClient.account.getSubaccounts(this.address)
        this.freeCollateralPercentage = Number(((response.subaccounts[0].freeCollateral * 100) / response.subaccounts[0].equity).toFixed(2))
        console.log(`\nequity: ${Number(response.subaccounts[0].equity).toFixed(2)} round ${this.roundCounter} free: ${this.freeCollateralPercentage}%`)
    }

    private async considerPositions() {
        const positions = (await this.indexerClient.account.getSubaccountPerpetualPositions(this.address, 0)).positions
        for (const position of positions) {
            if (position.closedAt === null) {
                await this.considerPosition(position)
            }
        }
    }

    private async considerPosition(position) {
        const marketData = (await this.indexerClient.markets.getPerpetualMarkets(position.market)).markets[position.market];
        const pnlInPerCent = (position.unrealizedPnl * 100) / (Math.abs(position.size) * position.entryPrice)
        this.updatePNLHistory(position.market, pnlInPerCent)
        const pnlHistory = this.pnlHistories.filter((e: IPNLHistory) => e.market === position.market)[0]
        const advice = this.getAdvice(pnlHistory, position.size, Number(marketData.stepSize))
        if (pnlHistory.pnls.length === this.historyLength || advice === EAdvice.CELEBRATE || advice === EAdvice.PREPARE) {
            const wallet = await LocalWallet.fromMnemonic(this.mnemonic, BECH32_PREFIX);
            const subaccount = new SubaccountClient(wallet, 0);
            await this.optimizePosition(position, subaccount, advice, Number(marketData.stepSize), marketData.oraclePrice)
        }
    }

    private async optimizePosition(position: any, subaccount: any, advice: EAdvice, mDStepSize: number, mDOraclePrice: number) {
        const id = `${this.roundCounter}-${position.market}`
        let size = mDStepSize * this.stepSizeFactor
        let goodTilTimeInSeconds1 = 3
        let side, price
        if (advice === EAdvice.INCREASE) {
            side = (position.side === "LONG") ? OrderSide.BUY : OrderSide.SELL
        } else if (advice === EAdvice.DECREASE) {
            side = (position.side === "LONG") ? OrderSide.SELL : OrderSide.BUY
        } else if (advice === EAdvice.CELEBRATE) {
            side = (position.side === "LONG") ? OrderSide.SELL : OrderSide.BUY
            size = Math.abs(position.size) - mDStepSize
        } else if (advice === EAdvice.PREPARE) {
            side = (position.side === "LONG") ? OrderSide.BUY : OrderSide.SELL
            size = mDStepSize * 5
        } else {
            return
        }
        price = (side === OrderSide.BUY) ? mDOraclePrice * 1.001 : mDOraclePrice * 0.999
        await this.compositeClient.placeOrder(subaccount, position.market, OrderType.MARKET, side, price, size, id, OrderTimeInForce.GTT, goodTilTimeInSeconds1, OrderExecution.DEFAULT)
    }

    private getAdvice(pnlHistory: IPNLHistory, positionSize: number, mDStepSize: number): EAdvice {
        const bollingerBands = Bollinger.getBollingerBands(pnlHistory.pnls, this.spreadFactor)
        const lower = bollingerBands.lower[pnlHistory.pnls.length - 1]
        const current = pnlHistory.pnls[pnlHistory.pnls.length - 1]
        const upper = bollingerBands.upper[pnlHistory.pnls.length - 1]
        if (current < lower && this.freeCollateralPercentage > this.targetCollateralPercentage) {
            console.log(`suggesting to increase ${pnlHistory.market} current: ${current} lower: ${lower}`)
            return EAdvice.INCREASE
        } else if (current >= this.celebrateAt && Math.abs(positionSize) > mDStepSize) {
            console.log(`suggesting to celebrate ${pnlHistory.market} current: ${current} celebrateAt: ${this.celebrateAt}`)
            return EAdvice.CELEBRATE
        } else if ((current > upper || this.freeCollateralPercentage < this.minCollateralPercentage) && Math.abs(positionSize) > mDStepSize) {
            console.log(`suggesting to decrease ${pnlHistory.market} current: ${current} upper: ${upper}`)
            return EAdvice.DECREASE
        } else if (current >= this.celebrateAt && Math.abs(positionSize) === mDStepSize) {
            console.log(`suggesting to prepare ${pnlHistory.market} current: ${current} positionSize: ${positionSize} ${mDStepSize}`)
            return EAdvice.PREPARE
        } else {
            return EAdvice.RELAX
        }
    }

    private updatePNLHistory(market: string, currentPNL: number) {
        const pnlHistory = this.pnlHistories.filter((e: IPNLHistory) => e.market === market)[0]
        if (pnlHistory === undefined) {
            this.pnlHistories.push({ market: market, pnls: [currentPNL] })
        } else if (pnlHistory.pnls.length === this.historyLength) {
            pnlHistory.pnls.splice(0, 1)
            pnlHistory.pnls.push(currentPNL)
        } else {
            pnlHistory.pnls.push(currentPNL)
        }
    }
}

config()

setTimeout(async () => {
    const compositeClient = await CompositeClient.connect(Network.mainnet());
    const collector = Collector.getInstance(process.env.ADDRESS as string, process.env.MNEMONIC as string, compositeClient)
    const historyLength = Number(process.argv[2])
    const celebrateAt = Number(process.argv[3])
    const intervalLength = Number(process.argv[4])
    const targetCollateralPercentage = Number(process.argv[5])
    const minCollateralPercentage = Number(process.argv[6])
    const stepSizeFactor = Number(process.argv[7])
    const spreadFactor = Number(process.argv[8])

    collector.prepare(historyLength, celebrateAt, intervalLength, targetCollateralPercentage, minCollateralPercentage, stepSizeFactor, spreadFactor)
    collector.play()
}, 1)
