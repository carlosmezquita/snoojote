const chalk = require('chalk');

class Logger {
    log(message) {
        console.log(`[LOG] ${message}`);
    }

    info(message) {
        console.log(chalk.blue(`[INFO] ${message}`));
    }

    success(message) {
        console.log(chalk.green(`[SUCCESS] ${message}`));
    }

    warn(message) {
        console.log(chalk.yellow(`[WARN] ${message}`));
    }

    error(message) {
        console.error(chalk.red(`[ERROR] ${message}`));
    }
}

module.exports = new Logger();
