historyLength=60
celebrateAt=1
intervalLength=24
targetCollateralPercentage=45
minCollateralPercentage=25
stepSizeFactor=1
spreadFactor=18

pm2 start ts-node --name=collect -- -P tsconfig.json collector.ts $historyLength $celebrateAt $intervalLength $targetCollateralPercentage $minCollateralPercentage $stepSizeFactor $spreadFactor