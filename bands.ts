// I buy and sell https://FreedomCash.org 
export interface IBollingerBands {
    sma: number[]
    lower: number[]
    upper: number[]
}

export class Bands {


    public static getBollingerBands(sequence: number[], factor: number = 2): IBollingerBands {

        const smaBand = Bands.getSMABand(sequence)
        const lowerBand: number[] = []
        const upperBand: number[] = []

        let counter = 0

        for (const entry of smaBand) {
            const helperBand = [...smaBand]

            helperBand.splice(counter, 1)
            const standardDeviation = Bands.getStandardDeviation(helperBand)

            lowerBand.push(entry - (standardDeviation * factor))
            upperBand.push(entry + (standardDeviation * factor))

            counter++
        }

        return {
            sma: smaBand,
            lower: lowerBand,
            upper: upperBand
        }
    }


    public static getSMABand(sequence: number[]): number[] {

        let counter = 0
        let sum = 0
        let result = []

        for (const entry of sequence) {
            counter++
            sum = sum + entry

            result.push(sum / counter)
        }

        return result

    }

    public static getStandardDeviation(sequence: number[]) {

        const average = Bands.calculateAverage(sequence)

        const substractedMeanFromEachAndSquared = Bands.substractMeanFromEachAndSquare(sequence, average)

        const meanOfSquaredDifferences = Bands.calculateAverage(substractedMeanFromEachAndSquared)

        return Math.sqrt(meanOfSquaredDifferences)

    }


    public static calculateAverage(sequence: number[]) {

        let sum = 0

        for (const entry of sequence) {
            sum = sum + entry
        }

        return sum / sequence.length

    }

    private static substractMeanFromEachAndSquare(sequence: number[], average: number): number[] {

        let squaredDifferences = []

        for (const entry of sequence) {
            squaredDifferences.push((entry - average) ** 2)
        }

        return squaredDifferences
    }

}