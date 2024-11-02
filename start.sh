historyLength=60
celebrateAt=1
intervalLength=6
targetCollateralPercentage=30
minCollateralPercentage=20
stepSizeFactor=6
spreadFactor=9

pm2 start ts-node --name=collect -- $historyLength $celebrateAt $intervalLength $targetCollateralPercentage $minCollateralPercentage $stepSizeFactor $spreadFactor -P tsconfig.json collector.ts