historyLength=33
celebrateAt=1.61803398874989
intervalLength=9
targetCollateralPercentage=45
minCollateralPercentage=24
spreadFactor=12
boostAt=-2.7182818284590455

ts-node collector.ts $historyLength $celebrateAt $intervalLength $targetCollateralPercentage $minCollateralPercentage $spreadFactor ${boostAt}
