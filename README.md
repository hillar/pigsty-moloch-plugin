#pigsty-moloch-plugin ver 0.0.0

## Moloch

see https://github.com/aol/moloch

## Pigsty

see https://github.com/threatstack/pigsty

## usage 

... in writing ...

```
 
 $# npm install https://github.com/hillar/pigsty-moloch-plugin/archive/master.tar.gz

 $# DEBUG=pigsty-moloch-plugin pigsty -c /etc/pigsty/config.js

 ```

## sample config

```

module.exports = {

  // you must remove this line!
  // unconfigured: true, 

  sensor: {
     // your sensor name, e.g. 'my-sensor-1' 
     name: 'pigsty',

     // your sensor interface, e.g. 'eth0'
     interface: 'eth0'
  },

  // these must be set correctly !
  references: {

    reference_file:      '/etc/suricata/reference.config',
    classification_file: '/etc/suricata/classification.config',
    gen_file:            '/etc/suricata/rules/gen-msg.map',
    sid_file:            '/etc/suricata/rules/sid-msg.map'
  },

  logs: {
    // e.g., /var/snort/logs
    path: '/var/log/suricata',

    // either 'continuous' or 'read'.  Will exit after reading unless mode == 'continuous'.
    mode: 'continuous', 

    // Where to store the bookmark for unified2 logs. default is /etc/pigsty/.bookmark
    bookmark: '/var/run/pigsty/.bookmark',

},

  // configure your output plugins here.
  output: {
  
    'moloch-plugin': {
	print_stats:  true,
	iniparser_module_location: '/opt/moloch/viewer/node_modules/iniparser/lib/node-iniparser.js',
	moloch_config_file_location: '/opt/moloch/etc/config.ini',
	async_module_location: '/opt/moloch/viewer/node_modules/async/lib/async.js',
	keepaliveagent_module_location: '/opt/moloch/viewer/node_modules/keep-alive-agent/index.js',
	db_module_location: '/opt/moloch/viewer/db.js'

    },
  } 
}

```