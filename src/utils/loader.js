const fs = require('node:fs');
const path = require('node:path');

/** Загружает все .js из папки; файл может экспортировать объект или массив объектов. */
module.exports = (dir) =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .flatMap((f) => [].concat(require(path.join(dir, f))));
