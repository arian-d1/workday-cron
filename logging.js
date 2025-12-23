import chalk from "chalk";

function logInfo(message) {
  console.log(chalk.cyan("[INFO]"), message);
}

function logSuccess(message) {
  console.log(chalk.green("[SUCCESS]"), message);
}

function logWarning(message) {
  console.log(chalk.yellow("[WARNING]"), message);
}

function logError(message) {
  console.error(chalk.red("[ERROR]"), message);
}

export { logInfo, logSuccess, logWarning, logError };
