var debug = require('debug')('pigsty-moloch-plugin');
var PigstyPlugin = require('pigsty-plugin');
var os = require('os');
var util = require('util');


molochPlugin.prototype = new PigstyPlugin();
molochPlugin.prototype.constructor = PigstyPlugin;
function molochPlugin(options) {
  PigstyPlugin.call(this, options);
  this.options = options;
  this.nodeName = os.hostname().split(".")[0];
  if (!this.options.queueMaxSize) {
    this.options.queueMaxSize = 1024;
  }
  if (!this.options.maxHeapSize){
    this.options.maxHeapSize = 1073741824/10;
  }
};


molochPlugin.prototype.getMolochOption = function (key, defaultValue) {
  var node = this.nodeName;
  var options = this.options.moloch
  if (options[node] && options[node][key] !== undefined) {
    return options[node][key];
  }
  if (options[node] && options[node].nodeClass && options[options[node].nodeClass] && options[options[node].nodeClass][key]) {
    return options[options[node].nodeClass][key];
  }
  if (options["default"][key]) {
    return options["default"][key];
  }
  if (options[key]) {
    return options[key];
  }
  return defaultValue;
};


molochPlugin.prototype.start = function(callback) {

  if (this.options.min_free_memory) {
    var freemem = os.freemem();
    if (this.options.min_free_memory > freemem) {
      this.emit('error','Over the limit of minimal free memory. Limit:'+this.options.min_free_memory+' Free:'+freemem);
      return;
    }
  }
  //todo check memory max limit...

  var iniParserLocation = 'iniparser'; //default to npm install iniparser -g
  if (this.options.iniparser_module_location){
    iniParserLocation = this.options.iniparser_module_location;
  }
  try {
    var iniParser = require(iniParserLocation);
  } catch (e) {
    this.emit('error',e);
    return;
  }

  this.options.moloch = iniParser.parseSync(this.options.moloch_config_file_location); 
  if (this.options.moloch["default"] === undefined) {
    this.emit('error', 'default setcion is missing in ' + this.options.moloch_config_file_location);
    return;
  }

  var tmp_escInfo = this.getMolochOption("elasticsearch");
  if (tmp_escInfo) {
     var escInfo = tmp_escInfo.split(':');
  } else {
    this.emit('error','elasticsearch data missing');
    return;
  }

  var asyncLocation = 'async'; //default to npm install async -g
  if (this.options.async_module_location){
    asyncLocation = this.options.async_module_location;
  }
  try {
    this.async = require(asyncLocation);
  } catch (e) {
    this.emit('error',e);
    return;
  }

  var KAALocation = 'keep-alive-agent'; //default to npm install keep-alive-agent -g
  if (this.options.keepaliveagent_module_location){
    KAALocation = this.options.keepaliveagent_module_location;
  }
  try {
    this.KAA = require(KAALocation);
  } catch (e) {
    this.emit('error',e);
    return;
  }

  if (this.options.db_module_location){
    var dbLocation = this.options.db_module_location;
  } else {
    this.emit('error', 'missing db module location in your config');
    return;
  }
  try {
    this.Db = require(dbLocation);
  } catch (e) {
    this.emit('error',e);
    return;
  }

  this.esHttpAgent = new this.KAA({maxSockets: 20}); // todo options here..
  this.Db.initialize({
        host: escInfo[0],
        port: escInfo[1],
        nodeName: this.nodeName,
        agent: this.esHttpAgent,
        dontMapTags: this.getMolochOption("multiES", false)
    });

  this.options.tcpSaveTimeout = this.getMolochOption('tcpSaveTimeout',3);
  this.queue = [];
  this.eventCountIN = 0;
  this.eventCountINLast = 0;
  self.timer = setInterval(function () {
    var now = new Date;
    var paused = '';
    if ( this.paused ) { paused = ' state: paused'; }
    var lastMinuteCount = this.eventCountIN - this.eventCountINLast;
    var lastMinuteRate = lastMinuteCount / 60;

    console.log('' + now + ' in queue:' + this.queue.length + ' in total: '+this.eventCountIN+' last minute:'+this.lastMinuteCount+' rate:'+lastMinuteRate+'eps' +paused);
    this.eventCountINLast = this.eventCountIN;
  }, 60 * 1000);

  this.emit('ready');
};


molochPlugin.prototype.close = function(callback) {
  //flusth queue ...
  for (var i = 0; i < (this.queue.length - 1); i++) {
    this.post(this.queue.pop());
    debug('flushing: ' + this.queue.length);
  }
  this.emit('end');
};

molochPlugin.prototype.getUnixTime = function () {
    return Math.floor(new Date().getTime() / 1000);
};

molochPlugin.prototype.send = function(event) {
  var _event = {}; 
  this.eventCountIN += 1;
  if (event && event.event && event.event.event_second) {
    _event.startTime = event.event.event_second;
    _event.endTime = event.event.event_second;
    _event.srcIP = event.event.source_ip;
    _event.srcPort = event.event.source_port;
    _event.dstIP = event.event.destination_ip;
    _event.dstPort = event.event.dest_port;
    _event.severity = event.event.classification.severity;
    _event.signatureID = event.event.signature.id;
    _event.signatureName = event.event.signature.name;

  } else {
    if (event && event.packets){
      _event.startTime = event.packets[0].raw.packet_second;
      _event.endTime = event.packets[event.packets.length-1].raw.packet_second;
      _event.debug = event;
    }
  }
  if (_event.startTime) {
    var needPause = false;
    if (this.paused){
      this.queue.push(_event);
      debug('emited full, but still getting events...');
    } else {
      
      if (this.queue.length > this.options.queueMaxSize) {
          needPause = true;
          debug('queue full');
      }

      var freemem = os.freemem();
      if (this.options.min_free_memory > freemem) {
          needPause = true;
          debug('memory almost full' + freemem);
      }

      var memusage = process.memoryUsage();
      if (memusage.heapUsed > (this.options.maxHeapSize)) {
        needPause = true;
        debug('heap full ' + memusage.heapUsed);
      }

      var diff = 1;
      var now = this.getUnixTime();
      if ( (now - this.options.tcpSaveTimeout) < _event.endTime ) {
        diff = now - this.options.tcpSaveTimeout - _event.endTime ;
        needPause = true;
        debug('need to wait moloch saves session ' + now + ' event time: ' + _event.endTime + ' diff:' + diff);
      }

      if (needPause){
        this.emit('full');
        this.queue.push(_event);
        var _this = this;
        this.paused = setInterval(function () {
                      debug('flushing after pause: ' + _this.queue.length);
                      for (var i = 0; i < (_this.queue.length - 1); i++) {
                        _this.post(_this.queue.pop());
                      }
                      clearInterval(_this.paused);
                      _this.paused = null;
                      _this.emit('ok');
                  }, (diff * 1000)+1000);
      } else {
        this.post(_event);
      }
    }
  }
};


molochPlugin.prototype.post = function(data) {
  console.dir(data);
};


module.exports = function(options) {
  return new molochPlugin(options);
};
