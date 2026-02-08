const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUUID(paramName = 'id') {
  return (req, res, next) => {
    const value = req.params[paramName];
    if (value && !UUID_REGEX.test(value)) {
      return res.status(400).json({
        error: 'Invalid ID format',
        message: `Parameter '${paramName}' must be a valid UUID`,
      });
    }
    next();
  };
}

module.exports = validateUUID;
