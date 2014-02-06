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
    this.options.eventQueueMaxSize = 128;
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
    }
  });

  this.options.tcpSaveTimeout = parseInt(this.getMolochOption('tcpSaveTimeout',3));
  this.eventQueue = [];
  this.eventsNotFound = [];
  this.tagsQueue = new HashTable();
  this.lastMissingIndice = '';
  this.searchTook = 10;
  this.updateTook = 10;
  this.inPost = 0;

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

function isSame(o1,o2){
  for (var key in o1){
    if ( o1[key] != o2[key] ) return false;
  }
  return true;
}

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
    var push = false;
    if (this.eventQueue.length > 0 ) {
      if ( !isSame(this.eventQueue[this.eventQueue.length-1],_event) ) {
        push = true;
      }
    } else {
      push = true;
    }
    if ( push ) this.eventQueue.push(_event);
    if (this.paused){
      //this.eventQueue.push(_event);
      debug('emited full, but still getting events...');
    } else {
      var needPause = false;

      if (this.eventQueue.length > this.options.eventQueueMaxSize) {
        debug('queue full', this.eventQueue.length, this.inPost, os.freemem(), process.memoryUsage().heapUsed);
        needPause = true;
        if (this.inPost < 256) {
          for (var i = 0; i < (this.eventQueue.length - 1); i++) {
            this.post(this.eventQueue.shift());
          }
          debug('queue flush ..left',this.eventQueue.length);
        }
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
        //this.eventQueue.push(_event);
        var _this = this;
        this.paused = setInterval(function () {
                      //debug('flushing after pause: ' + _this.eventQueue.length);
                      //can we flush ?
                      if (this.inPost < 256) {
                        for (var i = 0; i < (_this.eventQueue.length - 1); i++) {
                          _this.post(_this.eventQueue.shift());
                        }

                      }
                      clearInterval(_this.paused);
                      _this.paused = null;
                      _this.emit('ok');
                  }, (diff * 1000)+1000);
      } else {
        // is there something for post
        if ( this.eventQueue.length > (this.options.eventQueueMaxSize/2) && this.inPost < 256) {
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

function createQuery(time,srcIP,srcPort,dstIP,dstPort,protocol,timeout){
  return query = {
             "from":0, // say sort somewhere ?
             "size":10,
             "fields" : [], //["_id","fp","lp","a1","p1","no","ro"],
             "query":{
                "filtered":{
                   "filter":{
                      "bool":{
                         "must":[
                                /*{"term":{"no":this.nodeName+'*'}},*/ //terms as array of nodes ?
                                {"range":{"fp":{"gte":time - timeout - 1 }}},
                                {"range":{"lp":{"lte":time + timeout + 1 }}},
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
} 

molochPlugin.prototype.post = function(data) {

  var _results = {};
  _results.startTime = new Date().getTime();
  this.inPost += 1;
  var _this = this;

  var updateSession = function(callback) {
    //  debug('update got', JSON.stringify(_results));
    var _document = { script: "ctx._source.ta += ta", params: { ta: _results.tags } };
    // do bulk here ???
    _this.Db.update(_this.Db.id2Index(_results.sessionID), 'session', _results.sessionID, _document, function (err, result) {
      //debug('update result',err,result);
      _results.saved = true;
      if ( err ){
        _this.stats['sessionsTagFailed'] += 1;
        _this.emit('error',e);
        callback('update error ' + e);
      } else {
        if ( result.error ) {
          debug('update error',result);
          if ( result.status == 409 ) {
            // version conflict, try it again
            _this.eventQueue.push(data);
          } else {
            _this.emit('error',result.error);
            _this.stats['sessionsTagFailed'] += 1;
            callback('update result error :' + result.error);
          }
        } else {
          _this.stats['sessionsTagged'] += 1;
          callback(null,_results);
        }
      } 
    });
  }

  var findTag = function(tag,callback){
    var id = _this.tagsQueue.get(tag);
    if (id){
      _this.tagsQueue.remove(tag); // is it needed, or put just updates existing ?
      _this.tagsQueue.put(tag,{'id':id.id, 'count':id.count+1});
      callback(null,id.id);
    } else {
      _this.Db.tagNameToId(tag, function (id) {
        if (id === -1) {
            _this.Db.createTag(tag, function(newid) {
              _this.tagsQueue.put(tag,{'id':newid, 'count':1});
              callback(null,newid);
            });
        } else {
          _this.tagsQueue.put(tag,{'id':id, 'count':1});
          callback(null,id);
        }
      });
    }
  }

  var findTags = function(callback) {
      this.async.mapSeries(data.tags,findTag,function(err,result){
        if ( err ) {
          callback('tagging error' + JSON.stringify(e));
        } else {
          _results.tags = result;
          //debug('got tags', result);
          callback(null);
        }
      }); 
  }

  var findSessionID = function(callback){
      var _timeout = _this.options.tcpSaveTimeout + 60;
      var query = createQuery(data.time, data.srcIP, data.srcPort, data.dstIP, data.dstPort, data.protocol, _timeout);
      _this.Db.searchPrimary(_results.isIndiceName, 'session', query, function(err, result) {
        //debug('search result',JSON.stringify(result));
        _results.searchTook = (result.took);
        if (err) {
          this.emit(err)
          callback(err);
          return;
        }
        if (result.error) {
          this.emit(result.error);
          callback(_results.error);
          return;
        } 
        if ( result.hits.total > 0 && result.hits.hits[0] ) {
          _this.stats['sessionsFounded'] += 1;
          _results.sessionID = result.hits.hits[0]._id;
          callback(null);
        } else {
          _this.stats['sessionsNotFound'] += 1;
          callback('session not found:'+ JSON.stringify(_results) + JSON.stringify(result) + JSON.stringify(query));
          // -H for query 
        }
      });
  }

  var getIndiceName = function(callback){
      var d = new Date(data.time*1000);
      var _isIndiceName = 'sessions-' + twoDigitString(d.getUTCFullYear() % 100) + twoDigitString(d.getUTCMonth() + 1)+twoDigitString(d.getUTCDate());
      if (_this.dbStatustatus.indices[_isIndiceName] ) {
        _results.isIndiceName = _isIndiceName;
        callback(null);
      } else {
        if (_this.lastMissingIndice != _isIndiceName) {
          _this.lastMissingIndice = _isIndiceName; // cache the missing iname to avoid next status query
          //refresh status
          _this.Db.status("sessions-*", function (err, status) {
            if (err || status.error) {
              if (status.error) { 
                var e = status.error;
              } else {
                var e = err;
              }
              _this.emit('error', e);
              callback(e);
              return;
            } else {
              _this.dbStatustatus = status;
            }
          });
          if (_this.dbStatustatus.indices[_isIndiceName] ) {
            _results.isIndiceName = _isIndiceName;
            callback(null);
          } else {
            _this.emit('error', 'indice '+_isIndiceName+' does not exist');
            callback('indice do not exists' + _isIndiceName);
          }
      } else {
        callback('indice do not exists' + _isIndiceName);
      }
    }
  }
  // run it as waterfall with one paralel map
  this.async.waterfall([getIndiceName,findSessionID,findTags.bind(this),updateSession],function(e,r){
      if (e) {
        //all errors handled in funcs !
        //debug('POST ERROR',e);
      } else {
        _this.stats['sessionsTagged'] += 1;
      }
      _results.endTime = new Date().getTime();
      _results.taggingTime = _results.endTime - _results.startTime;
      _this.inPost -= 1; 
      debug('ended post', _this.inPost, _results.taggingTime);
  });
};


module.exports = function(options) {
  return new molochPlugin(options);
};
