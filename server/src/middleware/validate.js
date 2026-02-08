function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        details: error.details.map((d) => ({ message: d.message, path: d.path })),
      });
    }
    req.body = value;
    next();
  };
}

module.exports = validate;
