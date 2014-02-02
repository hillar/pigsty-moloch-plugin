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



molochPlugin.prototype = new PigstyPlugin();
molochPlugin.prototype.constructor = PigstyPlugin;
function molochPlugin(options) {
  PigstyPlugin.call(this, options);
  this.options = options;
  this.nodeName = os.hostname().split(".")[0];
  if (!this.options.eventQueueMaxSize) {
    this.options.eventQueueMaxSize = 1024;
  }
  if (!this.options.maxHeapSize){
    this.options.maxHeapSize = 1073741824*10;
  }
  if (!this.options.tag_prefix) {
    this.options.tag_prefix = 'unified2';
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


  if (this.options.print_stats){
    this.startingTime = new Date;
    this.statsLastValues = this.stats;
    if (!this.options.stats_interval) {
      this.options.stats_interval = 10;
    }
    var maxpad = 0;
    for (var key in this.stats){
      if ( key.length > maxpad ) {
        maxpad = key.length;
      }
    }
    var _this = this;
    this.timer = setInterval(function () {
      var now = new Date;
      var elapsed = ~~((now - _this.startingTime)/1000);
      var paused = '';
      if ( _this.paused ) { paused = ' (paused)'; }
      var current = _this.stats;
      var str = spaces(maxpad) + ' total\t eps\t last\t eps\n';
      for (var key in current){
        var t = current[key];
        var l = t - _this.statsLastValues[key];
        var r = ~~(l / _this.options.stats_interval);
        var e = ~~(t / elapsed);
        str += spaces(maxpad-key.length) + key + ' ' + t + '\t ' +e + '\t '+l+'\t '+r+'\n';
      }
      console.log('' + now + 'stats for period '+ _this.options.stats_interval + 's '+paused+'\n'+ str);
      _this.statsLastValues = current;
    }, this.options.stats_interval * 1000);
  }
  this.emit('ready');
};


molochPlugin.prototype.close = function(callback) {
  //flusth queue ...
  for (var i = 0; i < (this.eventQueue.length - 1); i++) {
    this.post(this.eventQueue.pop());
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
    _event.time = event.event.event_second;
    _event.srcIP = event.event.source_ip;
    _event.srcPort = event.event.source_port;
    _event.dstIP = event.event.destination_ip;
    _event.dstPort = event.event.dest_port;
    _event.tags = [];
    //todo options for tags...
    _event.tags.push(this.options.tag_prefix + '_severity_' + event.event.classification.severity);
    _event.tags.push(this.options.tag_prefix + '_classification_' + event.event.classification.name);
    _event.tags.push(this.options.tag_prefix + '_signatureID_' + event.event.signature.id);
    _event.tags.push(this.options.tag_prefix + '_signature_' + event.event.signature.name);

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
      /*
      if (this.inPost > 256) {
        needPause = true;
        //debug('post full');
      }
      */
      if (needPause){
        this.emit('full');
        this.eventQueue.push(_event);
        var _this = this;
        this.paused = setInterval(function () {
                      //debug('flushing after pause: ' + _this.eventQueue.length);
                      for (var i = 0; i < (_this.eventQueue.length - 1); i++) {
                        _this.post(_this.eventQueue.pop());
                      }
                      clearInterval(_this.paused);
                      _this.paused = null;
                      _this.emit('ok');
                  }, (diff * 1000)+1000);
      } else {

        this.post(_event);
      
      }
    }
  } else {
    this.stats['eventsDropped'] +=1;
  }
};


//helper funcs for post
molochPlugin.prototype.getTagIdFromMolochDB = function(tag, cb){
  var _this = this;
  this.Db.tagNameToId(tag, function (id) {
            if (id === -1) {
                //debug('not in db',tag);
                _this.Db.createTag(tag, function(newid) {
                  //debug('new tag',tag,newid);
                  cb(newid);
                });
            } else {
              cb(id);
            }
          });
}

molochPlugin.prototype.getSessionIDFromMolochDB = function(time,srcIP,srcPort,dstIP,dstPort,cb){
  // TODO proper indices support...
  var d = new Date(time*1000)
  var iname = 'sessions-' + twoDigitString(d.getUTCFullYear() % 100) + twoDigitString(d.getUTCMonth() + 1)+twoDigitString(d.getUTCDate());
  var ok = false;
  if (this.dbStatustatus.indices[iname] ) {
    ok = true;
  } else {
    if (this.lastMissingIndice != iname) {
      this.lastMissingIndice = iname;
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
                 "from":0,
                 "size":3,
                 "fields" : ["_id","fp","lp","a1","p1","no"],
                 "query":{
                    "filtered":{
                       "query":[ 
                                {"range":{"fp":{"lte":time}}},
                                {"range":{"lp":{"gte":time}}}
                              ]
                       ,
                       "filter":{
                          "bool":{
                             "must":[
                                    /*{"term":{"no":this.nodeName+'*'}},*/ 
                                    // add proto ?
                                    {"term":{"a1":srcIP}},
                                    {"term":{"p1":''+srcPort}},
                                    {"term":{"a2":dstIP}},
                                    {"term":{"p2":''+dstPort}}
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
      } else {
        cb(result.hits.hits);
      }
    });
  } else {
    // yeah, dossing into error log ;(
    this.emit('error','no indices for '+d);
  }
}

molochPlugin.prototype.saveTags2Session = function(sessionId,tagIDs,cb){
  var document = {
      script: "ctx._source.ta += ta",
      params: {
          ta: tagIDs
      }
  };
  this.Db.update(this.Db.id2Index(sessionId), 'session', sessionId, document, function (err, data) {
    //debug('update',err,data);
    if (err){
      this.emit('error',err);
      cb(false);
    } else {
      cb(true);
    } 
  });
}

molochPlugin.prototype.post = function(data) {
  this.stats['eventsPosted'] += 1;
  var _this = this;
  this.getSessionIDFromMolochDB(data.time, data.srcIP, data.srcPort, data.dstIP, data.dstPort, function(sessions){
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
            cb(null,id);
          } else {
            _this.getTagIdFromMolochDB(tag, function(_id){
              _this.tagsQueue.put(tag,_id);
              cb(null,_id);
            });
          }
        },
        function(err,ids){
          if (sessionId && ids.length > 0 ) {
            _this.saveTags2Session(sessionId,ids,function(ok){
              if (ok) {
                _this.stats['sessionsTagged'] += 1;
              } else {
                _this.stats['sessionsTagFailed'] += 1;
              }

            });

          } else {
            debug('should not never happen, founded session has no id or tags',sessionId,ids);

          }
        }
      );
     } else {
      //_this.eventsNotFound.push(data);
      //TODO...
      _this.stats['sessionsNotFound'] +=1;
    }
  });
};


module.exports = function(options) {
  return new molochPlugin(options);
};
