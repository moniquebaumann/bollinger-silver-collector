historyLength=60
celebrateAt=1
intervalLength=9
targetCollateralPercentage=30
minCollateralPercentage=20
stepSizeFactor=9
spreadFactor=12

ts-node collector.ts $historyLength $celebrateAt $intervalLength $targetCollateralPercentage $minCollateralPercentage $stepSizeFactor $spreadFactor 
