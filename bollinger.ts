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

    private readonly historyLength = 33
    private readonly minCollateralPercentage = 55
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
        }, 9 * 1000)
    }

    private async playRound() {
        this.roundCounter++
        let response = await this.indexerClient.account.getSubaccounts(this.address);
        const freeCollateralPercentage = (response.subaccounts[0].freeCollateral * 100) / response.subaccounts[0].equity
        console.log(`equity: ${response.subaccounts[0].equity} \nfree: ${response.subaccounts[0].freeCollateral} at round number ${this.roundCounter}`)
        response = await this.indexerClient.account.getSubaccountPerpetualPositions(this.address, 0);
        const positions = response.positions;
        for (const position of positions) {
            if (position.closedAt === null) {
                const pnlInPerCent = (position.unrealizedPnl * 100) / (Math.abs(position.size) * position.entryPrice)
                this.updatePNLHistory(position.market, pnlInPerCent)
                const pnlHistory = this.pnlHistories.filter((e: IPNLHistory) => e.market === position.market)[0]
                if (pnlHistory.pnls.length === this.historyLength) {
                    const bollingerBands = Bands.getBollingerBands(pnlHistory.pnls, 5)
                    const lower = bollingerBands.lower[pnlHistory.pnls.length - 1]
                    const current = pnlHistory.pnls[pnlHistory.pnls.length - 1]
                    const upper = bollingerBands.upper[pnlHistory.pnls.length - 1]
                    const advice = this.getAdvice(lower, current, upper, freeCollateralPercentage)
                    console.log(advice)
                    const wallet = await LocalWallet.fromMnemonic(this.mnemonic, BECH32_PREFIX);
                    const subaccount = new SubaccountClient(wallet, 0);
                    await this.optimizePosition(position, subaccount, advice)
                }
            }
        }
    }

    private getAdvice(lower: number, current: number, upper: number, freeCollateralPercentage: number) {
        if (current <= lower && freeCollateralPercentage > this.minCollateralPercentage) {
            return "Buy"
        } else if (current >= upper || freeCollateralPercentage < this.minCollateralPercentage) {
            return "Sell"
        } else {
            return "Relax"
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
        let goodTilTimeInSeconds1 = OrderTimeInForce.IOC
        let side, price
        if (advice === "Sell" && Math.abs(position.size) > marketData.stepSize) {
            console.log(`taking profits with ${position.market}`)
            side = OrderSide.SELL
            price = (side === OrderSide.BUY) ? marketData.oraclePrice * 1.001 : marketData.oraclePrice * 0.999
        } else if (advice === "Buy") {
            console.log(`increasing the exposure for position ${position.market}`)
            side = OrderSide.BUY
            price = (side === OrderSide.BUY) ? marketData.oraclePrice * 1.001 : marketData.oraclePrice * 0.999
            goodTilTimeInSeconds1 = OrderTimeInForce.GTT
        } else {
            console.log(`not doing anything with ${position.market} atm`)
            return
        }

        await this.compositeClient.placeOrder(subaccount, position.market, OrderType.MARKET, side, price, marketData.stepSize, id, OrderTimeInForce.GTT, goodTilTimeInSeconds1, OrderExecution.DEFAULT)
        await this.sleep(9000)
    }

    private sleep(ms: number) {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    }
}

config()
setTimeout(async () => {
    const compositeClient = await CompositeClient.connect(Network.mainnet());
    FreedomCashProvider.getInstance(process.env.ADDRESS as string, process.env.MNEMONIC as string, compositeClient).play()
}, 1)
