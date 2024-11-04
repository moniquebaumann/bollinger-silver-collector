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
    BOOST = "BOOST",
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
    private spreadFactor = 9
    private roundCounter = 0
    private freeCollateralPercentage = 0
    private pnlHistories: IPNLHistory[] = []
    private positions: any[] = []
    private initialPortfolio: any[] = []
    private subaccount: any
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

    public prepare(hL: number, cAt: number, iL: number, tCP: number, mCP: number, sF: number) {
        this.historyLength = hL
        this.celebrateAt = cAt
        this.intervalLength = iL
        this.targetCollateralPercentage = tCP
        this.minCollateralPercentage = mCP
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
        this.positions = (await this.indexerClient.account.getSubaccountPerpetualPositions(this.address, 0)).positions.filter((e: any) => e.closedAt === null)
        console.log(`\nequity: ${Number(response.subaccounts[0].equity).toFixed(2)} round ${this.roundCounter} free: ${this.freeCollateralPercentage}% positions: ${this.positions.length}`)
        const wallet = await LocalWallet.fromMnemonic(this.mnemonic, BECH32_PREFIX);
        this.subaccount = new SubaccountClient(wallet, 0);
        await this.ensureAllOpen()
    }

    private async considerPositions() {
        for (const position of this.positions) {
            const pnlInPerCent = (position.unrealizedPnl * 100) / (Math.abs(position.size) * position.entryPrice)
            this.updatePNLHistory(position.market, pnlInPerCent)
            const pnlHistory = this.pnlHistories.filter((e: IPNLHistory) => e.market === position.market)[0]
            const advice = this.getAdvice(pnlHistory, position)
            if (pnlHistory.pnls.length === this.historyLength) {
                await this.followAdvice(position, advice)
            }
        }
    }

    private getAdvice(pnlHistory: IPNLHistory, position: any): EAdvice {
        const bollingerBands = Bollinger.getBollingerBands(pnlHistory.pnls, this.spreadFactor)
        const lower = bollingerBands.lower[pnlHistory.pnls.length - 1]
        const current = pnlHistory.pnls[pnlHistory.pnls.length - 1]
        const upper = bollingerBands.upper[pnlHistory.pnls.length - 1]
        let stepSize = Math.abs(this.initialPortfolio.filter((e: any) => e.market === position.market)[0].initialAmount)
        if (current < lower && this.freeCollateralPercentage > this.targetCollateralPercentage) {
            return EAdvice.INCREASE
        } else if (current >= this.celebrateAt) {
            return EAdvice.CELEBRATE
        } else if ((current > upper || this.freeCollateralPercentage < this.minCollateralPercentage) && Math.abs(Number(position.size)) > stepSize) {
            return EAdvice.DECREASE
        } else if(current < (this.celebrateAt *  -1)) {
            return EAdvice.BOOST
        } else {
            return EAdvice.RELAX
        }
    }

    private async followAdvice(position: any, advice: EAdvice) {
        if (advice === EAdvice.RELAX) {
            // relax
        } else {
            const id = `${this.roundCounter}-${position.market}`
            let size = Math.abs(this.initialPortfolio.filter((e: any) => e.market === position.market)[0].initialAmount)
            let goodTilTimeInSeconds1 = 3
            let side, price
            if (advice === EAdvice.INCREASE) {
                side = (position.side === "LONG") ? OrderSide.BUY : OrderSide.SELL
            } else if (advice === EAdvice.DECREASE) {
                side = (position.side === "LONG") ? OrderSide.SELL : OrderSide.BUY
            } else if (advice === EAdvice.CELEBRATE) {
                side = (position.side === "LONG") ? OrderSide.SELL : OrderSide.BUY
                size = Math.abs(position.size)
            } else if (advice === EAdvice.BOOST) {
                size = Math.abs(position.size)
                side = (position.side === "LONG") ? OrderSide.BUY : OrderSide.SELL
            }
            const marketData = (await this.indexerClient.markets.getPerpetualMarkets(position.market)).markets[position.market]
            price = (side === OrderSide.BUY) ? marketData.oraclePrice * 1.001 : marketData.oraclePrice * 0.999
            console.log(`${advice} ${position.market}`)
            await this.compositeClient.placeOrder(this.subaccount, position.market, OrderType.MARKET, side, price, size, id, OrderTimeInForce.GTT, goodTilTimeInSeconds1, OrderExecution.DEFAULT)
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

    private async ensureAllOpen() {
        if (this.initialPortfolio.length === 0) {
            this.initialPortfolio = [
                { market: "ETH-USD", initialAmount: 0.001 },
                { market: "BTC-USD", initialAmount: -0.0001 },
                { market: "ETC-USD", initialAmount: 0.1 },
                { market: "XLM-USD", initialAmount: -10 },
                { market: "PEPE-USD", initialAmount: -10000000 },
                { market: "APT-USD", initialAmount: -1 },
                { market: "TRX-USD", initialAmount: 100 },
                { market: "DOGE-USD", initialAmount: -100 },
                { market: "NEAR-USD", initialAmount: 1 },
                { market: "LTC-USD", initialAmount: 0.1 },
                { market: "SUI-USD", initialAmount: 10 },
                { market: "DOT-USD", initialAmount: 1 },
                { market: "BNB-USD", initialAmount: -0.01 },
                { market: "XRP-USD", initialAmount: -10 },
                { market: "BCH-USD", initialAmount: 0.01 },
                { market: "AVAX-USD", initialAmount: -0.1 },
                { market: "SHIB-USD", initialAmount: 1000000 },
                { market: "TON-USD", initialAmount: 1 },
                { market: "ARB-USD", initialAmount: -1 },
                { market: "OP-USD", initialAmount: 1 },
                { market: "UNI-USD", initialAmount: 1 },
                { market: "LINK-USD", initialAmount: 1 },
                { market: "SOL-USD", initialAmount: 0.1 },
                { market: "ADA-USD", initialAmount: 10 },
                { market: "FIL-USD", initialAmount: 1 }
            ]
        }
        for (const asset of this.initialPortfolio) {
            const available = this.positions.filter((e: any) => e.market === asset.market && e.closedAt === null)[0]
            if (available === undefined) {
                const marketData = (await this.indexerClient.markets.getPerpetualMarkets(asset.market)).markets[asset.market];
                const id = `${this.roundCounter}-${asset.market}-ensureAllOpen`
                let size = Math.abs(asset.initialAmount)
                let goodTilTimeInSeconds1 = 3
                let side = (asset.initialAmount > 0) ? OrderSide.BUY : OrderSide.SELL
                let price = (side === OrderSide.BUY) ? marketData.oraclePrice * 1.001 : marketData.oraclePrice * 0.999
                console.log(`opening ${asset.market} position`)
                await this.compositeClient.placeOrder(this.subaccount, asset.market, OrderType.MARKET, side, price, size, id, OrderTimeInForce.GTT, goodTilTimeInSeconds1, OrderExecution.DEFAULT)
            }
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
    const spreadFactor = Number(process.argv[7])

    collector.prepare(historyLength, celebrateAt, intervalLength, targetCollateralPercentage, minCollateralPercentage, spreadFactor)
    collector.play()
}, 1)
