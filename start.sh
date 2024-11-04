historyLength=33
celebrateAt=1.618033988749895
intervalLength=24
targetCollateralPercentage=45
minCollateralPercentage=24
spreadFactor=12
boostAt=-2.7182818284590455

pm2 start ts-node --name=collect -- -P tsconfig.json collector.ts $historyLength $celebrateAt $intervalLength $targetCollateralPercentage $minCollateralPercentage $spreadFactor ${boostAt}