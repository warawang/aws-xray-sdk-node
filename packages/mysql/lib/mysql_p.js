/**
 * @module mysql_p
 */

var AWSXRay = require('@wmp-sbd/aws-xray-sdk-core');
var SqlData = AWSXRay.database.SqlData;

var DATABASE_VERS = process.env.MYSQL_DATABASE_VERSION;
var DRIVER_VERS = process.env.MYSQL_DRIVER_VERSION;

var PREPARED = 'statement';

/**
 * Patches the Node MySQL client to automatically capture query information for the segment.
 * Connection.query, connection.execute, and pool.query calls are automatically captured.
 * In manual mode, these functions require a segment or subsegment object as an additional,
 * last argument.
 * @param {mysql} module - The MySQL npm module.
 * @returns {mysql}
 * @see https://github.com/mysqljs/mysql
 */

module.exports = function captureMySQL(mysql) {
  if (mysql.__createConnection)
    return mysql;

  patchCreateConnection(mysql);
  patchCreatePool(mysql);

  return mysql;
};

function patchCreateConnection(mysql) {
  var baseFcn = '__createConnection';
  mysql[baseFcn] = mysql['createConnection'];

  mysql['createConnection'] = function patchedCreateConnection() {
    var connection = mysql[baseFcn].apply(connection, arguments);
    if (connection instanceof Promise) {
      connection = connection.then((result) => {
        patchObject(result.connection);
        return result;
      });
    } else if (connection.query instanceof Function) {
      patchObject(connection);
    }
    return connection;
  };
}

function patchCreatePool(mysql) {
  var baseFcn = '__createPool';
  mysql[baseFcn] = mysql['createPool'];

  mysql['createPool'] = function patchedCreatePool() {
    var pool = mysql[baseFcn].apply(pool, arguments);
    if (pool instanceof Promise) {
      pool = pool.then((result) => {
        patchObject(result.pool);
        return result;
      });
    } else if (pool.query instanceof Function) {
      patchObject(pool);
    }
    return pool;
  };
}

function patchObject(connection) {
  if (connection.query instanceof Function) {
    connection.__query = connection.query;
    connection.query = captureOperation('query');
  }

  if (connection.execute instanceof Function) {
    connection.__execute = connection.execute;
    connection.execute = captureOperation('execute');
  }
}

function resolveArguments(argsObj) {
  var args = {};

  if (argsObj && argsObj.length > 0) {
    if (argsObj[0] instanceof Object) {
      args.sql = argsObj[0].sql;
      args.values = argsObj[0].values;
      args.callback = argsObj[1];
    } else {
      args.sql = argsObj[0];
      args.values = typeof argsObj[1] !== 'function' ? argsObj[1] : null;
      args.callback = typeof argsObj[1] === 'function' ? argsObj[1] : (typeof argsObj[2] === 'function' ? argsObj[2] : undefined);
    }

    args.segment = (argsObj[argsObj.length-1] != null && argsObj[argsObj.length-1].constructor && (argsObj[argsObj.length-1].constructor.name === 'Segment' ||
      argsObj[argsObj.length-1].constructor.name === 'Subsegment')) ? argsObj[argsObj.length-1] : null;
  }

  return args;
}

function captureOperation(name) {
  return function() {
    var args = resolveArguments(arguments);
    var parent = AWSXRay.resolveSegment(args.segment);
    var command;
    var originalOperation = this['__'+name];

    if (args.segment)
      delete arguments[arguments.length-1];

    if (!parent) {
      AWSXRay.getLogger().info('Failed to capture MySQL. Cannot resolve sub/segment.');
      return originalOperation.apply(this, arguments);
    }

    var config = this.config.connectionConfig || this.config;
    var subsegment = parent.addNewSubsegment(config.database + '@' + config.host);

    if (args.callback) {
      var cb = args.callback;

      if (AWSXRay.isAutomaticMode()) {
        args.callback = function autoContext(err, data) {
          var session = AWSXRay.getNamespace();

          session.run(function() {
            AWSXRay.setSegment(subsegment);
            cb(err, data);
          });

          subsegment.close(err);
        };
      } else {
        args.callback = function wrappedCallback(err, data) {
          cb(err, data);
          subsegment.close(err);
        };
      }
    }

    command = originalOperation.call(this, args.sql, args.values, args.callback);

    if (!args.callback) {
      command.on('end', function() {
        subsegment.close();
      });

      var errorCapturer = function (err) {
        subsegment.close(err);

        if (this._events && this._events.error && this._events.error.length === 1) {
          this.removeListener('error', errorCapturer);
          this.emit('error', err);
        }
      };

      command.on('error', errorCapturer);
    }

    subsegment.addMetadata('sql', command.sql);
    subsegment.addMetadata('values', command.values);

    return command;
  }
}

function createSqlData(config, command) {
  var commandType = command.values ? PREPARED : null;

  var data = new SqlData(DATABASE_VERS, DRIVER_VERS, config.user,
    config.host + ':' + config.port + '/' + config.database,
    commandType);

  return data;
}
