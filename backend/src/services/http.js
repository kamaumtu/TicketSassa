function route(action) {
    return (req, res, next) => Promise.resolve(action(req, res)).catch(next);
}

module.exports = { route };
