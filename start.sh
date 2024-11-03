historyLength=33
celebrateAt=1.61803398874989
intervalLength=24
targetCollateralPercentage=45
minCollateralPercentage=24
spreadFactor=3

pm2 start ts-node --name=collect -- -P tsconfig.json collector.ts $historyLength $celebrateAt $intervalLength $targetCollateralPercentage $minCollateralPercentage $spreadFactor