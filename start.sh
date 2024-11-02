historyLength=60
celebrateAt=1
intervalLength=6
targetCollateralPercentage=30
minCollateralPercentage=20
stepSizeFactor=6
spreadFactor=9

pm2 start ts-node --name=collect -- -P tsconfig.json collector.ts $historyLength $celebrateAt $intervalLength $targetCollateralPercentage $minCollateralPercentage $stepSizeFactor $spreadFactor