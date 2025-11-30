const { glob } = require('glob');

module.exports = async (client) => {
    const eventFiles = await glob(`${process.cwd()}/src/features/**/events/*.js`);

    for (const file of eventFiles) {
        const event = require(file);
        if (event.name && event.execute) {
            if (event.once) {
                client.once(event.name, (...args) => event.execute(...args, client));
            } else {
                client.on(event.name, (...args) => event.execute(...args, client));
            }
            console.log(`[Handler] Loaded event: ${event.name}`);
        }
    }
};
