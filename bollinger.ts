import { config } from 'dotenv';
import { Network, IndexerClient, CompositeClient, BECH32_PREFIX, LocalWallet, OrderFlags, SubaccountClient, OrderSide, OrderType, OrderExecution, OrderTimeInForce } from '@dydxprotocol/v4-client-js';
import { Bands } from './bands';

export interface IPNLHistory {
    market: string
    pnls: number[]
}

export class FreedomCashProvider {

    private static instance: FreedomCashProvider
    public static getInstance(address: string, mnemonic: string, compositeClient: any): FreedomCashProvider {
        if (FreedomCashProvider.instance === undefined) {
            FreedomCashProvider.instance = new FreedomCashProvider(address, mnemonic, compositeClient)
        }
        return FreedomCashProvider.instance
    }

    private readonly historyLength =60
    private readonly celebrateAt = 1
    private readonly intervalLength = 60
    private readonly targetCollateralPercentage = 30
    private readonly minCollateralPercentage = 20
    private roundCounter
    private address
    private mnemonic
    private indexerClient
    private compositeClient
    private pnlHistories: IPNLHistory[] = []

    private constructor(address: string, mnemonic: string, compositeClient: any) {
        this.roundCounter = 0
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
        let response = await this.indexerClient.account.getSubaccounts(this.address);
        const freeCollatPercentage = Number(((response.subaccounts[0].freeCollateral * 100) / response.subaccounts[0].equity).toFixed(2))
        console.log(`equity: ${response.subaccounts[0].equity} \nfree: ${freeCollatPercentage} % at round number ${this.roundCounter}`)
        response = await this.indexerClient.account.getSubaccountPerpetualPositions(this.address, 0);
        const positions = response.positions;
        for (const position of positions) {
            // if (position.market !== "DOGE-USD") { continue }
            if (position.closedAt === null) {
                const pnlInPerCent = (position.unrealizedPnl * 100) / (Math.abs(position.size) * position.entryPrice)
                this.updatePNLHistory(position.market, pnlInPerCent)
                const pnlHistory = this.pnlHistories.filter((e: IPNLHistory) => e.market === position.market)[0]
                const bollingerBands = Bands.getBollingerBands(pnlHistory.pnls, 9)
                const lower = bollingerBands.lower[pnlHistory.pnls.length - 1]
                const current = pnlHistory.pnls[pnlHistory.pnls.length - 1]
                const upper = bollingerBands.upper[pnlHistory.pnls.length - 1]
                const advice = this.getAdvice(lower, current, upper, freeCollatPercentage)
                console.log(`${advice} ${position.market}`)
                if (pnlHistory.pnls.length === this.historyLength || advice === "Celebrate") {
                    const wallet = await LocalWallet.fromMnemonic(this.mnemonic, BECH32_PREFIX);
                    const subaccount = new SubaccountClient(wallet, 0);
                    await this.optimizePosition(position, subaccount, advice)
                }
            }
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

    private async optimizePosition(position: any, subaccount: any, advice: string) {
        const marketData = (await this.indexerClient.markets.getPerpetualMarkets(position.market)).markets[position.market];
        const id = `${this.roundCounter}-${position.market}`
        let size = marketData.stepSize
        let side, price, goodTilTimeInSeconds1
        if (advice === "Increase") {
            side = (position.side === "LONG") ? OrderSide.BUY : OrderSide.SELL
            goodTilTimeInSeconds1 = OrderTimeInForce.IOC
        } else if (advice === "Decrease" && Math.abs(position.size) > marketData.stepSize) {
            side = (position.side === "LONG") ? OrderSide.SELL : OrderSide.BUY
            goodTilTimeInSeconds1 = OrderTimeInForce.GTT
        } else if (advice === "Celebrate" && Math.abs(position.size) > marketData.stepSize) {
            side = (position.side === "LONG") ? OrderSide.SELL : OrderSide.BUY
            goodTilTimeInSeconds1 = OrderTimeInForce.GTT
            size = Math.abs(position.size) - marketData.stepSize
            console.log(`position.size: ${position.size}`)
            console.log(`marketData.stepSize: ${marketData.stepSize}`)
            console.log(`size: ${size}`)
        } else {
            return
        }
        price = (side === OrderSide.BUY) ? marketData.oraclePrice * 1.001 : marketData.oraclePrice * 0.999
        await this.compositeClient.placeOrder(subaccount, position.market, OrderType.MARKET, side, price, size, id, OrderTimeInForce.GTT, goodTilTimeInSeconds1, OrderExecution.DEFAULT)
    }

    private getAdvice(lower: number, current: number, upper: number, freeCollateralPercentage: number) {
        if (current <= lower && freeCollateralPercentage > this.targetCollateralPercentage) {
            return "Increase"
        } else if (current >= upper || freeCollateralPercentage < this.minCollateralPercentage) {
            return "Decrease"
        } else if (current >= this.celebrateAt) {
            return "Celebrate"
        } else {
            return "Relax"
        }
    }
}

config()
setTimeout(async () => {
    const compositeClient = await CompositeClient.connect(Network.mainnet());
    FreedomCashProvider.getInstance(process.env.ADDRESS as string, process.env.MNEMONIC as string, compositeClient).play()
}, 1)
