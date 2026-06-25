function wrapAsync(router) {
  ["get", "post", "put", "patch", "delete"].forEach((method) => {
    const original = router[method].bind(router);
    router[method] = (path, ...handlers) => {
      const wrapped = handlers.map((handler) => (req, res, next) => {
        Promise.resolve(handler(req, res, next)).catch(next);
      });
      return original(path, ...wrapped);
    };
  });
  return router;
}

module.exports = wrapAsync;
