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

    private readonly historyLength = 60
    private readonly celebrateAt = 1
    private readonly intervalLength = 60
    private readonly targetCollateralPercentage = 30
    private readonly minCollateralPercentage = 20
    private readonly spreadFactor = 9

    private address
    private mnemonic
    private indexerClient
    private compositeClient
    private roundCounter = 0
    private freeCollateralPercentage = 0
    private pnlHistories: IPNLHistory[] = []

    private constructor(address: string, mnemonic: string, compositeClient: any) {
        this.address = address
        this.mnemonic = mnemonic
        this.indexerClient = new IndexerClient(Network.mainnet().indexerConfig)
        this.compositeClient = compositeClient
    }

    public play() {
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
        console.log(`equity: ${response.subaccounts[0].equity} \nfree: ${this.freeCollateralPercentage} % at round number ${this.roundCounter}`)
    }

    private async considerPositions(){
        const positions = await this.indexerClient.account.getSubaccountPerpetualPositions(this.address, 0).positions
        for (const position of positions) {
            if (position.closedAt === null) {
                await this.considerPosition(position)
            }
        }
    }

    private async considerPosition(position) {
        const pnlInPerCent = (position.unrealizedPnl * 100) / (Math.abs(position.size) * position.entryPrice)
        this.updatePNLHistory(position.market, pnlInPerCent)
        const pnlHistory = this.pnlHistories.filter((e: IPNLHistory) => e.market === position.market)[0]
        const bollingerBands = Bollinger.getBollingerBands(pnlHistory.pnls, this.spreadFactor)
        const lower = bollingerBands.lower[pnlHistory.pnls.length - 1]
        const current = pnlHistory.pnls[pnlHistory.pnls.length - 1]
        const upper = bollingerBands.upper[pnlHistory.pnls.length - 1]
        const advice = this.getAdvice(lower, current, upper)
        console.log(`${advice} ${position.market}`)
        if (pnlHistory.pnls.length === this.historyLength || advice === EAdvice.CELEBRATE) {
            const wallet = await LocalWallet.fromMnemonic(this.mnemonic, BECH32_PREFIX);
            const subaccount = new SubaccountClient(wallet, 0);
            await this.optimizePosition(position, subaccount, advice)
        }
    }

    private async optimizePosition(position: any, subaccount: any, advice: EAdvice) {
        const marketData = (await this.indexerClient.markets.getPerpetualMarkets(position.market)).markets[position.market];
        const id = `${this.roundCounter}-${position.market}`
        let size = marketData.stepSize
        let side, price, goodTilTimeInSeconds1
        if (advice === EAdvice.INCREASE) {
            side = (position.side === "LONG") ? OrderSide.BUY : OrderSide.SELL
            goodTilTimeInSeconds1 = OrderTimeInForce.IOC
        } else if (advice === EAdvice.DECREASE && Math.abs(position.size) > marketData.stepSize) {
            side = (position.side === "LONG") ? OrderSide.SELL : OrderSide.BUY
            goodTilTimeInSeconds1 = OrderTimeInForce.GTT
        } else if (advice === EAdvice.CELEBRATE && Math.abs(position.size) > marketData.stepSize) {
            side = (position.side === "LONG") ? OrderSide.SELL : OrderSide.BUY
            goodTilTimeInSeconds1 = OrderTimeInForce.GTT
            size = Math.abs(position.size) - marketData.stepSize
        } else {
            return
        }
        price = (side === OrderSide.BUY) ? marketData.oraclePrice * 1.001 : marketData.oraclePrice * 0.999
        await this.compositeClient.placeOrder(subaccount, position.market, OrderType.MARKET, side, price, size, id, OrderTimeInForce.GTT, goodTilTimeInSeconds1, OrderExecution.DEFAULT)
    }

    private getAdvice(lower: number, current: number, upper: number): EAdvice {
        if (current <= lower && this.freeCollateralPercentage > this.targetCollateralPercentage) {
            return EAdvice.INCREASE
        } else if (current >= this.celebrateAt) {
            return EAdvice.CELEBRATE
        } else if (current >= upper || this.freeCollateralPercentage < this.minCollateralPercentage) {
            return EAdvice.DECREASE
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
    Collector.getInstance(process.env.ADDRESS as string, process.env.MNEMONIC as string, compositeClient).play()
}, 1)
