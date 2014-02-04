var debug = require('debug')('pigsty-moloch-plugin');
var PigstyPlugin = require('pigsty-plugin');
var os = require('os');
var HashTable = require('hashtable');


function ntoa(ipl) {
  return ((ipl >>> 24) + '.' +
          (ipl >> 16 & 255) + '.' +
          (ipl >> 8 & 255) + '.' +
          (ipl & 255));
};

function twoDigitString(value) {
  return (value < 10) ? ("0" + value) : value.toString();
}

function spaces(count){
  var space = "";
  for (var i=0; i < count; i++){
    space += " ";
  }
  return space;
}

function human(int,power){  //does -H ;)
  if (!power) var power = 1024;
  Math.log10 = function(n) {
      return (Math.log(n)) / (Math.log(10));
  }
  var units = ["", "K", "M", "G", "T","P"];
  var digit = ~~(Math.log10(int)/Math.log10(power));
  return ~~(int/Math.pow(1024, digit)) + "" + units[digit];
}


molochPlugin.prototype = new PigstyPlugin();
molochPlugin.prototype.constructor = PigstyPlugin;
function molochPlugin(options) {
  PigstyPlugin.call(this, options);
  this.options = options;
};

// helper to get options from moloch config

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
  this.nodeName = os.hostname().split(".")[0];
  if (!this.options.eventQueueMaxSize) {
    this.options.eventQueueMaxSize = 1024;
  }
  if (!this.options.maxHeapSize){
    this.options.maxHeapSize = 1073741824*10;
  }
  if (!this.options.minFreeMemory){
    this.options.minFreeMemory = 1073741824/10;
  }
  if (!this.options.tagPrefix) {
    this.options.tagPrefix = 'unified2';
  }
  if (this.options.minFreeMemory) {
    var freemem = os.freemem();
    if (this.options.minFreeMemory > freemem) {
      this.emit('error','Over the limit of minimal free memory. Limit:'+this.options.minFreeMemory+' Free:'+freemem);
      return;
    }
  }
  var memusage = process.memoryUsage();
  if (memusage.heapUsed > (this.options.maxHeapSize)) {
    this.emit('error','Over the limit of maximal heap memory. Limit' + this.options.maxHeapSize);
    return
  }
  if (!this.options.molochConfigFileLocation){
    this.emit('error','moloch config file location is not defined, please add it to pigsty config moloch plugin section molochConfigFileLocation');
    return;
  }

  if (!this.options.iniparserModuleLocation){
    this.options.iniparserModuleLocation = 'iniparser';
  }
  try {
    var iniParser = require(this.options.iniparserModuleLocation);
  } catch (e) {
    this.emit('error',e);
    return;
  }
  try {
    this.options.moloch = iniParser.parseSync(this.options.molochConfigFileLocation); 
  } catch (e) {
    this.emit('error','cant load moloch config file '+this.options.molochConfigFileLocation);
    return;
  }
  if (this.options.moloch["default"] === undefined) {
    this.emit('error', 'default setcion is missing in ' + this.options.molochConfigFileLocation);
    return;
  }

  var tmp_escInfo = this.getMolochOption("elasticsearch");
  if (tmp_escInfo) {
     var escInfo = tmp_escInfo.split(':');
  } else {
    this.emit('error','elasticsearch data missing');
    return;
  }

  if (!this.options.asyncModuleLocation){
    this.options.asyncModuleLocation = 'async';
  }
  try {
    this.async = require(this.options.asyncModuleLocation);
  } catch (e) {
    this.emit('error',e);
    return;
  }

  if (!this.options.keepaliveagentModuleLocation){
    this.options.keepaliveagentModuleLocation = 'keep-alive-agent';
  }
  try {
    this.KAA = require(this.options.keepaliveagentModuleLocation);
  } catch (e) {
    this.emit('error',e);
    return;
  }

  if (!this.options.dbModuleLocation){
    this.emit('error', 'missing db module location in your config');
    return;
  }
  try {
    this.Db = require(this.options.dbModuleLocation);
  } catch (e) {
    this.emit('error',e);
    return;
  }
  if ( !this.options.maxKeepAliveSockets ) {
    this.options.maxKeepAliveSockets = 32;
  }
  this.esHttpAgent = new this.KAA({maxSockets: this.options.maxKeepAliveSockets }); 
  this.Db.initialize({
        host: escInfo[0],
        port: escInfo[1],
        nodeName: this.nodeName,
        agent: this.esHttpAgent,
        dontMapTags: this.getMolochOption("multiES", false)
    });

  // todo check ela flush time from template
  // curl http://localhost:9200/_template/template_1\?pretty 
  var _this = this;
  this.Db.status("sessions-*", function (err, status) {
    if (err || status.error) {
      if (status.error) { 
        var e = status.error;
      } else {
        var e = err;
      }
      this.emit('error', e);
      return;
    } else {
      _this.dbStatustatus = status;
  debug(status._shards);
    }
  });

  this.options.tcpSaveTimeout = this.getMolochOption('tcpSaveTimeout',3);
  this.eventQueue = [];
  this.eventsNotFound = [];
  this.tagsQueue = new HashTable();
  this.lastMissingIndice = '';

  this.stats = [];
  this.stats['eventsIn'] = 0;
  this.stats['eventsDropped'] = 0;
  this.stats['eventsPosted'] = 0;
  this.stats['sessionsFounded'] = 0;
  this.stats['sessionsNotFound'] = 0;
  this.stats['sessionsTagged'] = 0;
  this.stats['sessionsTagFailed'] = 0;


  if (this.options.printStatstoConsole){
    this.startingTime = new Date();
    this.statsLastValues = [];
    if ( !this.options.printStatsInterval ) {
      this.options.printStatsInterval = 10;
    }
    var maxpad = 0;
    for (var key in this.stats){
      if ( key.length > maxpad ) {
        maxpad = key.length;
      }
    }
    var runningSince = new Date(this.startingTime * 1000);
    var _this = this;
    this.timer = setInterval(function () {
      var now = new Date;
      var elapsed = ~~((now - _this.startingTime)/1000);
      var paused = '';
      if ( _this.paused ) { paused = ' (paused)'; }
      var str = spaces(maxpad) + ' total\t eps\t last\t eps\n';
      var current = _this.stats;
      var tmp = _this.statsLastValues;
      
      for (var key in current){
        var total = current[key];
        var last = total - tmp[key];
        var leps = ~~(last / _this.options.printStatsInterval);
        var teps = ~~(total / elapsed);
        total = human(total);
        last = human(last);
        teps = human(teps);
        leps = human(leps);
        str += spaces(maxpad-key.length) + key + ' ' + total + '\t ' +teps + '\t '+last+'\t '+leps+'\n';
        _this.statsLastValues[key] = total;
      }
      if (_this.eventQueue.length > 0) {
        var qfirst = _this.eventQueue[0];
        var qlast = _this.eventQueue[_this.eventQueue.length-1];
        qfirst = new Date(qfirst.time*1000);
        qlast = new Date(qlast.time*1000);
        str += spaces(maxpad-9) + ' in queue ' + _this.eventQueue.length + ' ( ' + qfirst + ' - ' + qlast + ' )\n';
      }
      var lastEventTime = new Date(_this.lastEventTime * 1000);
      console.log('' + now +' running since ' + runningSince + ' elapsed ' + elapsed +'s');
      console.log('stats for period '+ _this.options.printStatsInterval + 's last event '+ lastEventTime + ' ' + paused +'\n'+ str);
      
    }, this.options.printStatsInterval * 1000);
  }
  //done prep, go ..
  this.emit('ready');
};


molochPlugin.prototype.close = function(callback) {
  //flusth queue async ?
  for (var i = 0; i < (this.eventQueue.length - 1); i++) {
    this.post(this.eventQueue.shift());
    debug('flushing: ' + this.eventQueue.length);
  }
  // gc here ?
  this.emit('end');
};

molochPlugin.prototype.getUnixTime = function () {
    return Math.floor(new Date().getTime() / 1000);
};

molochPlugin.prototype.send = function(event) {
  var _event = {}; 
  this.stats['eventsIn'] += 1;
  if (event && event.event && event.event.event_second) {
    this.lastEventTime = event.event.event_second;
    _event.time = event.event.event_second;
    _event.srcIP = event.event.source_ip;
    _event.srcPort = event.event.source_port;
    _event.dstIP = event.event.destination_ip;
    _event.dstPort = event.event.dest_port;
    _event.protocol = event.event.protocol;
    _event.tags = [];
    //todo options for tags...
    _event.tags.push(this.options.tagPrefix + '_severity_' + event.event.classification.severity);
    _event.tags.push(this.options.tagPrefix + '_classification_' + event.event.classification.name);
    _event.tags.push(this.options.tagPrefix + '_signatureID_' + event.event.signature.id);
    _event.tags.push(this.options.tagPrefix + '_signature_' + event.event.signature.name);

    this.eventCount += 1;

    if (this.paused){
      this.eventQueue.push(_event);
      debug('emited full, but still getting events...');
    } else {
      var needPause = false;

      if (this.eventQueue.length > this.options.eventQueueMaxSize) {
        needPause = true;
        debug('queue full');
      }

      var freemem = os.freemem();
      if (this.options.minFreeMemory > freemem) {
          needPause = true;
          debug('memory almost full' + freemem);
      }

      var memusage = process.memoryUsage();
      if (memusage.heapUsed > (this.options.maxHeapSize)) {
        needPause = true;
        debug('heap full ' + memusage.heapUsed);
      }

      var diff = 1;

      if (needPause){
        this.emit('full');
        this.eventQueue.push(_event);
        var _this = this;
        this.paused = setInterval(function () {
                      //debug('flushing after pause: ' + _this.eventQueue.length);
                      for (var i = 0; i < (_this.eventQueue.length - 1); i++) {
                        _this.post(_this.eventQueue.shift());
                      }
                      clearInterval(_this.paused);
                      _this.paused = null;
                      _this.emit('ok');
                  }, (diff * 1000)+1000);
      } else {
        this.post(_event);
        // is there something for second round ...
        if ( this.eventQueue.length > 0 ) {
          var now = this.getUnixTime();
          if (( this.eventQueue[0].time + (this.options.tcpSaveTimeout + 61)/2 ) < now ) {
            this.post(this.eventQueue.shift());
          }
        }
      }
    }
  } else {
    this.stats['eventsDropped'] +=1;
  }
};


// ** helper funcs for post **

molochPlugin.prototype.getTagIdFromMolochDB = function(tag, cb){
  var _this = this;
  this.Db.tagNameToId(tag, function (id) {
    if (id === -1) {
        _this.Db.createTag(tag, function(newid) {
          cb(newid);
        });
    } else {
      cb(id);
    }
  });
}

molochPlugin.prototype.getSessionIDFromMolochDB = function(time,srcIP,srcPort,dstIP,dstPort,protocol,cb){
  // TODO proper indices support...
  var d = new Date(time*1000)
  var iname = 'sessions-' + twoDigitString(d.getUTCFullYear() % 100) + twoDigitString(d.getUTCMonth() + 1)+twoDigitString(d.getUTCDate());
  var ok = false;
  if (this.dbStatustatus.indices[iname] ) {
    ok = true;
  } else {
    if (this.lastMissingIndice != iname) {
      this.lastMissingIndice = iname; // cache the missing iname to avoid next status query
      //refresh status
      var _this = this;
      this.Db.status("sessions-*", function (err, status) {
        if (err || status.error) {
          if (status.error) { 
            var e = status.error;
          } else {
            var e = err;
          }
          _this.emit('error', e);
          return;
        } else {
          _this.dbStatustatus = status;
        }
      });
      if (_this.dbStatustatus.indices[iname] ) {
        ok = true;
      }
    }
  }
  if (ok) {
    var query = {
                 "from":0, // say sort somewhere ?
                 "size":10,
                 "fields" : ["_id","fp","lp","a1","p1","no","ro"],
                 "query":{
                    "filtered":{
                       "filter":{
                          "bool":{
                             "must":[
                                    /*{"term":{"no":this.nodeName+'*'}},*/ //terms as array of nodes ?
                                    {"range":{"fp":{"gte":time - this.options.tcpSaveTimeout - 1 }}},
                                    {"range":{"lp":{"lte":time + this.options.tcpSaveTimeout + 1 }}},
                                    {"range":{"fp":{"lte":time}}},
                                    {"range":{"lp":{"gte":time}}},
                                    {"term":{"a1":srcIP}},
                                    {"term":{"p1":''+srcPort}},
                                    {"term":{"a2":dstIP}},
                                    {"term":{"p2":''+dstPort}},
                                    {"term":{"pr":''+protocol}}
                                    ]
                              }
                          }
                        }
                     }
                  }
    var _this = this;
    this.Db.searchPrimary(iname, 'session', query, function(err, result) {
      if (err || result.error) {
         debug('query error',JSON.stringify(query),JSON.stringify(result),err);
        _this.emit("error","Could not fetch list of sessions.  Err: " + err );
        // not calling callback, is it bad or good thing ?
      } else {
        if (result.hits.total > 0) {
          cb(result.hits.hits);
        }
      }
    });
  } else {
    // yeah, dossing into error log ;(
    this.emit('error','no indices for '+d);
  }
}

molochPlugin.prototype.post = function(data) {
  this.stats['eventsPosted'] += 1;
  var _this = this;
  this.getSessionIDFromMolochDB(data.time, data.srcIP, data.srcPort, data.dstIP, data.dstPort, data.protocol, function(sessions){
    if ( sessions.length > 0 ){ 
      _this.stats['sessionsFounded'] += 1;
      var sessionId;
      if ( sessions.length === 1 ) {
        sessionId = sessions[0]._id;
      } else {
        sessionId = sessions[0]._id;
        // todo ...
          for (var i = 0; i < (sessions.length - 2); i++) {
               debug('sess time:',sessions[i].fields.fp,'<', data.time,'>', sessions[i].fields.lp,sessions[i].fields.no,sessions[i].fields.a1,sessions[i].fields.p1,sessions[i].fields.a2,sessions[i].fields.p2)
          }
      }
      _this.async.map(data.tags,
        function (tag, cb) {
          var id = _this.tagsQueue.get(tag);
          if (id){
            _this.tagsQueue.put(tag,{'id':id.id, 'count':id.count+1});
            cb(null,id.id);
          } else {
            _this.getTagIdFromMolochDB(tag, function(_id){
              _this.tagsQueue.put(tag,{'id':_id, 'count':1});
              cb(null,_id);
            });
          }
        },
        function (err, ids) {
          if (sessionId && ids.length > 0 ) {
            // todo: change from tags to plugin bla bla
            var document = { script: "ctx._source.ta += ta", params: { ta: ids } };
            // do bulk here ???
            _this.Db.update(_this.Db.id2Index(sessionId), 'session', sessionId, document, function (err, result) {
              //debug('update',err,result);
              if ( err || result.error ){
                debug('update error',err,result);
                _this.stats['sessionsTagFailed'] += 1;
                if ( err ) {
                  var e = err;
                } else {
                  var e = result.error;
                }
                _this.emit('error',e);
              } else {
                _this.stats['sessionsTagged'] += 1;
              } 
            });
          } else {
            debug('should not never happen, founded session has no id or tags',sessionId,ids);
          }
        }
      );
     } else {
      // if session timeout is not yet there, try later again ...
      var now = _this.getUnixTime();
      if (( data.time + _this.options.tcpSaveTimeout + 61) > now ) {
        _this.eventQueue.push(data);
      } else {
        _this.stats['sessionsNotFound'] +=1;
      }
    }
  });
};


module.exports = function(options) {
  return new molochPlugin(options);
};
