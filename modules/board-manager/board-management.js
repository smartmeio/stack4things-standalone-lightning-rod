//############################################################################################
//##
//# Copyright (C) 2014-2018 Dario Bruneo, Francesco Longo, Giovanni Merlino, Nicola Peditto
//##
//# Licensed under the Apache License, Version 2.0 (the "License");
//# you may not use this file except in compliance with the License.
//# You may obtain a copy of the License at
//##
//# http://www.apache.org/licenses/LICENSE-2.0
//##
//# Unless required by applicable law or agreed to in writing, software
//# distributed under the License is distributed on an "AS IS" BASIS,
//# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//# See the License for the specific language governing permissions and
//# limitations under the License.
//##
//############################################################################################

//service logging configuration: "board-management"   
var logger = log4js.getLogger('board-management');


var fs = require("fs");
var crypto = require('crypto');
var Q = require("q");
var requestify = require('requestify');
//var os = require('os');


var exec = require('child_process').exec;
//var spawn = require('child_process').spawn;

var board_session = null;
var LIGHTNINGROD_HOME = process.env.LIGHTNINGROD_HOME;
var PKG_MNG_SUPPORTED = ["apt", "apt-get", "pip", "pip3", "opkg"];


function signatureKey() {

    try {
        var privateKey = fs.readFileSync('/var/lib/iotronic/ssl/client.key', 'utf-8');
        var sign = crypto.createSign('RSA-SHA256');
        sign.update(boardCode);
        sign.end();
        return sign.sign(privateKey);
    }
    catch(err){
        logger.error('[SYSTEM] - signatureKey error: ' + JSON.stringify(err));
    }

}


// This function contains the logic that has to be performed if LR is connected to the WAMP server
function manage_WAMP_connection(session) {

    logger.info('[CONFIGURATION] - Board configuration starting...');

    //EXPORTING NETWORK COMMANDS
    checkModEnabled("vnets_manager").then(
        
        function (enabled) {

            if(enabled){
                var networksManager = require(LIGHTNINGROD_HOME + '/modules/vnets-manager/manage-networks');
                networksManager.Init(session);
            }

        }

    );
    
    //Topic on which the board can send a message to be registered
    var connectionTopic = 'board.connection';
    session.subscribe(connectionTopic, onTopicConnection);
    
    //Registering the board to the Cloud by sending a message to the connection topic
    //logger.info("[WAMP] - Sending board ID '" + boardCode + "' to topic " + connectionTopic + " to register the board");

    logger.info("[AUTH] - Authentication mode: " + auth_lr_mode);

    switch (auth_lr_mode) {

        case 'basic':
            //Send board_id to authenticate the board in Iotronic

            session.publish(connectionTopic, [boardCode, 'connection', session._id]);
            break;

        case 'password':

            //Send board_id and password to authenticate the board in Iotronic

            session.publish(connectionTopic, [boardCode, 'connection', session._id, auth_pw]);
            break;

        case 'certs':

            //Send board_id and signature to authenticate the board in Iotronic

            var board_signature = signatureKey();
            logger.debug("[AUTH] --> Board signature:\n"+board_signature.toString('hex'));

            session.publish(connectionTopic, [boardCode, 'connection', session._id, board_signature.toString('base64')]);
            break;


        default:

            logger.error("[SYSTEM] --> Wrong authentication mode: " + auth_lr_mode);

            break;

    }



}

// This function manages the messages published in "board.connection" topic
function onTopicConnection(args) {
    var message = args[0];
    if (message == 'IoTronic-connected')
        logger.info("Message on board.connection: " + args[0])
    
}

function checkModEnabled(module_name) {

    var d = Q.defer();

    try {

        var configFile = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));

        var modules = configFile.config["board"]["modules"]; //console.log(module_name, modules[module_name]);

        d.resolve(modules[module_name]["enabled"]);
    }
    catch(err){
        logger.error('[SYSTEM] - checkModEnabled error: ' + JSON.stringify(err));
        d.resolve(false);
    }

    return d.promise;

}

// This function loads the Lightning-rod modules
function moduleLoader (session, device) {

    try {
        logger.info("[SYSTEM] - Modules loading:");

        var configFile = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));

        var modules = configFile.config["board"]["modules"];

        var modules_keys = Object.keys(modules);

        for (var i = 0; i < modules_keys.length; i++) {

            (function (i) {

                var module_name = modules_keys[i];
                var enabled = modules[module_name]["enabled"];


                if (enabled)

                    switch (module_name) {

                        case 'plugins_manager':
                            logger.info("[SYSTEM] --> " + module_name + ": " + enabled);
                            var pluginsManager = require(LIGHTNINGROD_HOME + '/modules/plugins-manager/manage-plugins');
                            pluginsManager.Init(session);
                            break;

                        case 'services_manager':
                            logger.info("[SYSTEM] --> " + module_name + ": " + enabled);
                            var servicesManager = require(LIGHTNINGROD_HOME + '/modules/services-manager/manage-services');
                            servicesManager.Init(session);

                            break;

                        case 'nodered_manager':
                            logger.info("[SYSTEM] --> " + module_name + ": " + enabled);
                            var nodeRedManager = require(LIGHTNINGROD_HOME + '/modules/nodered-manager/manage-nodered');
                            nodeRedManager.Init(session);
                            break;

                        /*
                        case 'vnets_manager':
                            break;
                        */

                        case 'gpio_manager':
                            logger.info("[SYSTEM] --> " + module_name + ": " + enabled);
                            var gpioManager = require(LIGHTNINGROD_HOME + '/modules/gpio-manager/manage-gpio');
                            gpioManager.Init(session, lyt_device);
                            break;

                        case 'drivers_manager':
                            logger.info("[SYSTEM] --> " + module_name + ": " + enabled);
                            var driversManager = require(LIGHTNINGROD_HOME + "/modules/drivers-manager/manage-drivers");
                            driversManager.Init(session);
                            driversManager.restartDrivers();
                            break;

                        case 'vfs_manager':
                            logger.info("[SYSTEM] --> " + module_name + ": " + enabled);
                            var fsManager = require(LIGHTNINGROD_HOME + "/modules/vfs-manager/manage-fs");
                            fsManager.Init(session);
                            var fsLibsManager = require(LIGHTNINGROD_HOME + "/modules/vfs-manager/manage-fs-libs");
                            fsLibsManager.exportFSLibs(session);
                            break;

                        default:

                            //logger.error("[SYSTEM] --> Wrong module: " + module_name)

                            break;


                    }


            })(i);

        }

    }
    catch(err){
        logger.error('[SYSTEM] - moduleLoader error: ' + JSON.stringify(err));
    }

}


// This function loads at boot the Lightning-rod modules
exports.moduleLoaderOnBoot = function() {

    logger.info("[SYSTEM] - Modules loading on boot:");

    try {

        var configFile = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
        var modules = configFile.config["board"]["modules"]; //console.log(modules);
        var modules_keys = Object.keys(modules); //console.log(modules_keys);

        //STARTING ENABLED MANAGERS
        for (var i = 0; i < modules_keys.length; i++) {

            (function (i) {

                var module_name = modules_keys[i];
                var enabled = modules[module_name]["boot"];

                if (enabled)

                    switch (module_name) {

                        case 'plugins_manager':
                            logger.info("[SYSTEM] --> " + module_name + ": " + enabled);
                            var pluginsManager = require(LIGHTNINGROD_HOME + '/modules/plugins-manager/manage-plugins');
                            pluginsManager.Boot();
                            break;

                        case 'services_manager':
                            logger.info("[SYSTEM] --> " + module_name + ": " + enabled);
                            var servicesManager = require(LIGHTNINGROD_HOME + '/modules/services-manager/manage-services');
                            servicesManager.Boot();
                            break;

                        case 'nodered_manager':
                            logger.info("[SYSTEM] --> " + module_name + ": " + enabled);
                            var nodeRedManager = require(LIGHTNINGROD_HOME + '/modules/nodered-manager/manage-nodered');
                            nodeRedManager.Boot();
                            break;

                        case 'vnets_manager':
                            logger.info("[SYSTEM] --> " + module_name + ": " + enabled);
                            break;

                        case 'gpio_manager':
                            logger.info("[SYSTEM] --> " + module_name + ": " + enabled);
                            break;

                        case 'drivers_manager':
                            logger.info("[SYSTEM] --> " + module_name + ": " + enabled);
                            break;

                        case 'vfs_manager':
                            logger.info("[SYSTEM] --> " + module_name + ": " + enabled);

                        default:

                            logger.warn("[SYSTEM] --> Wrong module: " + module_name);

                            break;


                    }


            })(i);

        }

        //START BOARD-MANAGER CONNECTIONS TESTS PROCEDURES
        if (wamp_socket_recovery == true || wamp_socket_recovery == "true") {

            logger.info('[BOOT] - Board Manager connection controller starting...');
            logger.info('[BOOT] --> Crossbar IP: ' + wampIP + " - Port: " + port_wamp);

            // connectionTester: library used to check the reachability of Iotronic-Server/WAMP-Server
            var connectionTester = require('connection-tester');

            conn_alive_timer = 60; //second between check-connection retries
            conn_retry_counter = 0; //counter for check-connection retries
            wampboot_retry_counter = 0; //counter for check-connection retries

            setTimeout(function () {

                var output = connectionTester.test(wampIP, port_wamp, 10000);
                var reachable = output.success;
                var error_test = output.error;

                if (!reachable) {

                    //CONNECTION STATUS: FALSE
                    logger.warn("[BOARD-CONNECTION-RECOVERY] - INTERNET CONNECTION STATUS: " + reachable + " - ERROR: " + error_test);

                    checkInternetWampConnection = setInterval(function () {

                        //logger.warn("[BOARD-CONNECTION-RECOVERY] - RETRY...");

                        connectionTester.test(wampIP, port_wamp, 10000, function (err, output) {

                            var reachable = output.success;
                            var error_test = output.error;

                            if (!reachable) {

                                //CONNECTION STATUS: FALSE
                                logger.warn("[BOARD-CONNECTION-RECOVERY] - INTERNET CONNECTION STATUS: " + reachable + " - ERROR: " + error_test);

                            } else {

                                try {

                                    // Test if IoTronic is connected to the realm
                                    board_session.call("s4t.iotronic.isAlive", [boardCode]).then(
                                        function (response) {

                                            conn_retry_counter = 0;
                                            clearInterval(checkInternetWampConnection);

                                        },
                                        function (err) {

                                            logger.warn("NO WAMP CONNECTION YET!")

                                        }
                                    );

                                } catch (err) {

                                    wampboot_retry_counter = wampboot_retry_counter + 1;

                                    logger.warn('[BOARD-CONNECTION-RECOVERY] - Error calling "s4t.iotronic.isAlive"');

                                    if (conn_retry_counter >= 5) {

                                        logger.warn("LR restarting in 5 seconds");
            
                                        restart_time = 5;
            
                                        // activate listener on-exit event after LR exit on-update-conf
                                        process.on("exit", function () {
            
                                            require("child_process").spawn(process.argv.shift(), process.argv, {
                                                cwd: process.cwd(),
                                                detached: true,
                                                stdio: "inherit"
                                            });
            
                                        });
            
                                        //Restarting LR
                                        setTimeout(function () {
            
                                            process.exit();
            
                                        }, restart_time * 1000);
            
            
                                    }
                                }


                            }

                        });


                    }, conn_alive_timer * 1000);

                } else {

                    checkInternetWampConnection = setInterval(function () {

                        conn_retry_counter = conn_retry_counter + 1;

                        try {

                            // Test if IoTronic is connected to the realm
                            board_session.call("s4t.iotronic.isAlive", [boardCode]).then(
                                function (response) {

                                    conn_retry_counter = 0;
                                    clearInterval(checkInternetWampConnection);

                                },
                                function (err) {

                                    logger.warn("[CONN-RETRY] - " + conn_retry_counter);
                                    logger.warn("[BOARD-CONNECTION-RECOVERY] - No WAMP connection yet!")

                                }
                            );

                        } catch (err) {

                            logger.warn("[CONN-RETRY] - " + conn_retry_counter);
                            logger.warn('[BOARD-CONNECTION-RECOVERY] - Internet connection available BUT wamp session not established!');
                            logger.warn("--> WAMP connection error:" + err);

                        }

                        if (conn_retry_counter >= 5) {

                            logger.warn("LR restarting in 5 seconds");

                            restart_time = 5;

                            // activate listener on-exit event after LR exit on-update-conf
                            process.on("exit", function () {

                                require("child_process").spawn(process.argv.shift(), process.argv, {
                                    cwd: process.cwd(),
                                    detached: true,
                                    stdio: "inherit"
                                });

                            });

                            //Restarting LR
                            setTimeout(function () {

                                process.exit();

                            }, restart_time * 1000);


                        }


                    }, conn_alive_timer * 1000);

                }


            }, 5000);

        }

    }
    catch(err){
        logger.error('[SYSTEM] - moduleLoaderOnBoot error: ' + JSON.stringify(err));
    }

};


// Init() LR function in order to control the correct LR configuration:
// - logging setup
// - settings control
exports.Init_Ligthning_Rod = function (callback) {

    log4js.loadAppender('file');

    function LogoLR() {
        logger.info('##############################');
        logger.info('  Stack4Things Lightning-rod');
        logger.info('##############################');

        logger.info('#       version ' + LR_VERSION + '        #');
        logger.info('##############################');
        logger.info('[SYSTEM] - LR PID: ' + LR_PID);
    }

    var HealthManager = require(LIGHTNINGROD_HOME + '/modules/board-manager/local_health_server');
    HealthManager.start();

    /*
     OFF	nothing is logged
     FATAL	fatal errors are logged
     ERROR	errors are logged
     WARN	warnings are logged
     INFO	infos are logged
     DEBUG	debug infos are logged
     TRACE	traces are logged
     ALL	everything is logged
     */

    try {

        //check logfile parameter
        logfile = nconf.get('config:log:logfile');

        if (logfile === "undefined" || logfile == "") {
            // DEFAULT LOGGING CONFIGURATION LOADING
            logfile = './s4t-lightning-rod.log';
            log4js.addAppender(log4js.appenders.file(logfile));
            logger = log4js.getLogger('main');		//service logging configuration: "main"

            LogoLR();

            callback({result: "ERROR"});

        } else {

            try{
                log4js.addAppender(log4js.appenders.file(logfile));
                logger = log4js.getLogger('main');          //service logging configuration: "main"
            }
            catch (err) {
                console.log("Error in log folder creation!")
            }

            LogoLR();

            //check loglevel parameter
            loglevel = nconf.get('config:log:loglevel');

            if (loglevel === "undefined" || loglevel == "") {

                logger.setLevel('INFO');
                logger.warn('[SYSTEM] - LOG LEVEL not specified... default has been set: INFO');

            } else {

                logger.setLevel(loglevel);
                logger.info('[SYSTEM] - LOG LEVEL: ' + loglevel);

            }

            //Start LR settings checks
            exports.checkSettings(function (check) {

                if (check === true) {
                    callback({result: "SUCCESS"});
                } else {
                    callback({result: "ERROR"});
                }

            });

        }

    }
    catch (err) {
        // DEFAULT LOGGING
        logfile = './s4t-lightning-rod.log';
        log4js.addAppender(log4js.appenders.file(logfile));
        logger = log4js.getLogger('main');		//service logging configuration: "main"
        LogoLR();
        logger.error('[SYSTEM] - Logger configuration error: ' + err);
        callback({result: "ERROR"});

    }

};


// This function checks the settings correctness
exports.checkSettings = function (callback) {

    try {

        var check_response = null;

        //WAMP CONF
        url_wamp = nconf.get('auth:wamp:url_wamp');
        port_wamp = nconf.get('auth:wamp:port_wamp');
        realm = nconf.get('auth:wamp:realm');

        if ((url_wamp == undefined || url_wamp == "") || (port_wamp == undefined || port_wamp == "") || (realm == undefined || realm == "")) {

            logger.warn('[SYSTEM] - WAMP configuration is wrong or not specified!');
            logger.debug(' - url_wamp value: ' + url_wamp);
            logger.debug(' - port_wamp value: ' + port_wamp);
            logger.debug(' - realm value: ' + realm);

            process.exit();

        }
        else {
            check_response = true;
        }

        //WSTUN CONF
        wstun_url = nconf.get('auth:wstun:ws_url');
        wstun_port = nconf.get('auth:wstun:ws_port');
        wstun_lib = nconf.get('auth:wstun:bin');

        if ((wstun_url == undefined || wstun_url == "") || (wstun_port == undefined || wstun_port == "") || (wstun_lib == undefined || wstun_lib == "")) {

            logger.warn('[SYSTEM] - WSTUN configuration is wrong or not specified!');
            logger.debug(' - wstun_url value: ' + wstun_url);
            logger.debug(' - wstun_port value: ' + wstun_port);
            logger.debug(' - wstun_lib value: ' + wstun_lib);

            process.exit();

        } else {
            check_response = true;
        }

        // BOARD CONF
        device = nconf.get('auth:board:layout');
        if (device == undefined || device == "") {
            logger.warn('[SYSTEM] - Device "' + device + '" not supported!');
            logger.warn(' - Supported devices are: "laptop", "arduino_yun", "raspberry_pi".');
            process.exit();
        }

        boardCode = nconf.get('auth:board:code');
        if (boardCode == undefined || boardCode == "") {
            logger.warn('[SYSTEM] - Board UUID undefined or not specified!');
            process.exit();
        } else {
            check_response = true;
        }

        auth_lr_mode = nconf.get('auth:board:authentication:auth_lr_mode');
        auth_pw = nconf.get('auth:board:authentication:password');

        reg_status = nconf.get('auth:board:status');
        boardLabel = nconf.get('config:board:label');
        board_position = nconf.get('config:board:position');

        // VNETs: SOCAT CONF
        var socat_port = nconf.get('config:board:modules:vnets_manager:socat:client:port');

        if (socat_port == undefined || socat_port == "") {
            logger.warn("[SYSTEM] - 'socat_port' not specified or 'undefined': if the board is network enabled specify this parameter!");
        }

        callback(check_response);


    }
    catch (err) {
        // DEFAULT LOGGING
        log4js = require('log4js');
        log4js.loadAppender('file');
        logfile = './s4t-lightning-rod.log';
        log4js.addAppender(log4js.appenders.file(logfile));

        //service logging configuration: "main"
        logger = log4js.getLogger('main');

        logger.error('[SYSTEM] - ' + err);
        process.exit();

    }


};


// This function sets the coordinates of the device: called by Iotronic via RPC
exports.setBoardPosition = function (args) {

    try {

        var board_position = args[0];
        //logger.info("[SYSTEM] - Set board position: " + JSON.stringify(board_position));

        var configFile = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
        var board_config = configFile.config["board"];
        logger.info("[SYSTEM] --> BOARD CONFIGURATION " + JSON.stringify(board_config));

        board_config["position"] = board_position;
        logger.info("[SYSTEM] --> BOARD POSITION UPDATED: " + JSON.stringify(board_config["position"]));

        //Updates the settings.json file
        fs.writeFile(SETTINGS, JSON.stringify(configFile, null, 4), function (err) {
            if (err) {
                logger.error('[SYSTEM] --> Error writing settings.json file: ' + err);
            } else {
                logger.debug("[SYSTEM] --> settings.json configuration file saved to " + SETTINGS);
            }
        });

    }
    catch(err){
        logger.error('[SYSTEM] - setBoardPosition error: ' + JSON.stringify(err));
    }

    return "Board configuration file updated!";


};


// This function create the settings.json file of the board injected by IoTronic
exports.updateConf = function (args) {

    var d = Q.defer();

    var response = {
        message: '',
        result: ''
    };

    try {

        // activate listener on-exit event after LR exit on-update-conf
        logger.debug("[SYSTEM] - Listener on process 'exit' event activated:");
        logger.debug("[SYSTEM] --> Lightning-rod PID: " + process.pid);
        process.on("exit", function () {
            require("child_process").spawn(process.argv.shift(), process.argv, {
                cwd: process.cwd(),
                detached: true,
                stdio: "inherit"
            });
        });


        var remote_conf = args[0].message;

        logger.info("[SYSTEM] - Board configuration injected: " + JSON.stringify(remote_conf, null, "\t"));

        logger.info("[SYSTEM] --> BOARD CONF UPDATED: " + JSON.stringify(remote_conf));

        //Updates the settings.json file
        fs.writeFile(SETTINGS, JSON.stringify(remote_conf, null, "\t"), function (err) {
            if (err) {

                response.message = 'Error writing settings.json file: ' + err;
                response.result = "ERROR";
                logger.error('[SYSTEM] --> ' + response.message);
                d.resolve(response);

            } else {

                logger.debug("[SYSTEM] --> settings.json configuration file saved to " + SETTINGS);
                response.message = "Board '" + boardCode + "' configuration updated!";
                response.result = "SUCCESS";
                d.resolve(response);

                //Restarting LR
                setTimeout(function () {
                    process.exit();
                }, 1000)


            }
        });

    }
    catch(err){
        response.result = "ERROR";
        response.message = JSON.stringify(err);
        logger.error('[SYSTEM] - updateConf error: '+response.message);
        d.resolve(response);
    }

    return d.promise;

};


// This function update the board configuration
exports.setConf = function (args) {

    var d = Q.defer();

    var response = {
        message: '',
        result: ''
    };

    try {

        var remote_conf = args[0].message;

        logger.info("[SYSTEM] - Board configuration injected: " + JSON.stringify(remote_conf, null, "\t"));


        // activate listener on-exit event after LR exit on-update-conf
        logger.debug("[SYSTEM] --> Listener on process 'exit' event activated:");
        logger.debug("[SYSTEM] --> Lightning-rod PID: " + process.pid);
        process.on("exit", function () {
            require("child_process").spawn(process.argv.shift(), process.argv, {
                cwd: process.cwd(),
                detached: true,
                stdio: "inherit"
            });
        });


        logger.info("[SYSTEM] --> Updating board configuration: " + JSON.stringify(remote_conf));

        //Updates the settings.json file
        fs.writeFile(SETTINGS, JSON.stringify(remote_conf, null, "\t"), function (err) {
            if (err) {

                response.message = 'Error writing settings.json file: ' + err;
                response.result = "ERROR";
                logger.error('[SYSTEM] --> ' + response.message);
                d.resolve(response);

            } else {

                logger.debug("[SYSTEM] --> settings.json configuration file saved to " + SETTINGS);
                response.message = "Board '" + boardCode + "' configuration updated!";
                response.lr_version = LR_VERSION;
                response.result = "SUCCESS";
                d.resolve(response);


            }
        });

    }
    catch(err){
        response.result = "ERROR";
        response.message = JSON.stringify(err);
        logger.error('[SYSTEM] - setConf error: '+response.message);
        d.resolve(response);
    }

    return d.promise;

};


// This function manages the registration status of the board
exports.checkRegistrationStatus = function(args){

    var d = Q.defer();

    var response = {
        message: '',
        lr_version: LR_VERSION,
        result: ''
    };

    try {

        /*
        // check NICs
        logger.info("[SYSTEM] - Device network interfaces:");
        var net_nics = getIfaces()
        logger.info("[SYSTEM] --> ifaces:\n" +JSON.stringify(net_nics.message, null, "\t"))
        */



        var regStatus = args[0];

        if (regStatus.result == "SUCCESS") {

            logger.info("[SYSTEM] - Connection to Iotronic " + regStatus.result + ":\n" + JSON.stringify(regStatus.message, null, "\t"));

            //export RPC
            exports.exportManagementCommands(board_session);

            if (regStatus.message['state'] == "new") {

                logger.info('[CONFIGURATION] - New board configuration started... ');

                var confBundle = {
                    message: ''
                };

                confBundle.message = regStatus.message['conf'];

                exports.setConf([confBundle]).then(
                    function (msg) {

                        console.log(msg);

                        d.resolve(msg);

                        //Restarting LR
                        setTimeout(function () {
                            process.exit();
                        }, 2000)


                    }
                )


            } else if (regStatus.message['state'] == "registered") {

                logger.info("[SYSTEM] - Board registered - Start module loading... ");

                moduleLoader(board_session, lyt_device);

                response.message = "Board '" + boardCode + "' is loading modules.";
                response.result = "SUCCESS";
                d.resolve(response);


            } else if (regStatus.message['state'] == "updated") {

                logger.info('[CONFIGURATION] - Updated board configuration started... ');

                var confBundle = {
                    message: ''
                };

                confBundle.message = regStatus.message['conf'];

                exports.setConf([confBundle]).then(
                    function (msg) {

                        console.log(msg);

                        d.resolve(msg);

                        //Restarting LR
                        setTimeout(function () {
                            process.exit();
                        }, 2000)


                    }
                )

            } else {

                d.resolve("Board " + boardCode + " in wrong status!");

                logger.error('[CONFIGURATION] - WRONG BOARD STATUS: status allowed "new" or "registerd"!');
                process.exit();

            }


        }
        else {

            // IF access to IoTronic was rejected
            logger.error("[SYSTEM] - Connection to Iotronic " + regStatus.result + " - " + regStatus.message);
            logger.info("[SYSTEM] - Bye");

            d.resolve("Board " + boardCode + " disconnection...");

            process.exit();

        }

    }
    catch(err){
        response.result = "ERROR";
        response.message = JSON.stringify(err);
        logger.error('[SYSTEM] - checkRegistrationStatus error: '+response.message);
        d.resolve(response);
    }
    return d.promise;

};


// This function executes the LR package update
exports.updateLR = function(args){

    logger.info("[SYSTEM] - Updating LR RPC called...");

    var d = Q.defer();

    var response = {
        message: '',
        result: ''
    };

    try {

        var lr_version = args[0];
        var pkg_mng = args[1];
        var operation = args[2];

        var lr_pkg_name = "node-iotronic-lightning-rod";

        if (pkg_mng == "opkg") {

            var pkg_name = lr_pkg_name;

        } else if (pkg_mng == "apt" || pkg_mng == "apt-get") {

            if (lr_version != undefined && lr_version != "")
                var pkg_name = lr_pkg_name + "=" + lr_version;
            else
                var pkg_name = lr_pkg_name;

        }

        var pkg_opts = "";

        if (operation == "update" || operation == undefined || operation == "") {

            var pkg_mng_cmd = "install";

            managePackage(pkg_mng, pkg_mng_cmd, pkg_opts, pkg_name, function (pack) {

                pack.lr_version = exports.getLRversion();

                console.log(pack);

                d.resolve(pack);

            });

        } else {

            response.message = "Operation '" + operation + "' on Lightning-rod package not supported!";
            response.result = "ERROR";
            logger.error("[SYSTEM] --> " + response.message);
            d.resolve(response);
        }

    }
    catch(err){
        response.result = "ERROR";
        response.message = JSON.stringify(err);
        logger.error('[SYSTEM] - updateLR error: '+response.message);
        d.resolve(response);
    }

    return d.promise;

};

// To execute pre-defined commands in the board shell
exports.execAction = function(args){

    var action = args[0];
    var params = args[1];

    logger.info("[SYSTEM] - execAction on board RPC called: '" + action + "' action...");

    var d = Q.defer();

    var response = {
        message: '',
        result: ''
    };

    try {

        switch (action) {

            case 'reboot':

                logger.info('[SYSTEM] - Rebooting...');
                response.message = "Rebooting";
                response.result = "SUCCESS";
                d.resolve(response);

                exec('reboot', function (error, stdout, stderr) {

                    try {

                        if (error) {
                            logger.error('[SYSTEM] - Reboot result: ' + error);
                            response.message = error;
                            response.logs = error.message;
                            response.result = "ERROR";
                            d.resolve(response);
                        } else if (stderr) {
                            if (stderr == "")
                                stderr = "rebooting...";

                            logger.info('[SYSTEM] - Reboot result: ' + stderr);
                            response.message = stderr;
                            response.result = "WARNING";
                            d.resolve(response);
                        } else {
                            logger.info('[SYSTEM] - Reboot result: ' + stdout);
                            response.message = stdout;
                            response.result = "SUCCESS";
                            d.resolve(response);
                        }
                    }
                    catch(err){
                        response.result = "ERROR";
                        response.message = JSON.stringify(err);
                        logger.error('[SYSTEM] - execAction "' + action + '" error: ' + response.message);
                        d.resolve(response);
                    }


                });

                break;


            case 'hostname':

                exec('echo `hostname`@`date`', function (error, stdout, stderr) {

                    try {

                        if (error) {
                            logger.error('[SYSTEM] - Echo result: ' + error);
                            response.message = error;
                            response.logs = error.message;
                            response.result = "ERROR";
                            d.resolve(response);
                        } else if (stderr) {
                            if (stderr == "")
                                stderr = "Doing echo...";

                            logger.info('[SYSTEM] - Echo result: ' + stderr);
                            response.message = stderr;
                            response.result = "WARNING";
                            d.resolve(response);
                        } else {
                            stdout = stdout.replace(/\n$/, '');
                            logger.info('[SYSTEM] - Echo result: ' + stdout);
                            response.message = stdout;
                            response.result = "SUCCESS";
                            d.resolve(response);
                        }
                    }
                    catch(err){
                        response.result = "ERROR";
                        response.message = JSON.stringify(err);
                        logger.error('[SYSTEM] - execAction "' + action + '" error: ' + response.message);
                        d.resolve(response);
                    }

                });
                break;


            case 'mount_status':

                exec('cat /proc/mounts', function (error, stdout, stderr) {

                    //cat /proc/mounts |grep " / \|sda"

                    try {

                        if (error) {
                            logger.error('[SYSTEM] - Mount status result (error): ' + error);
                            response.message = error;
                            response.logs = error.message;
                            response.result = "ERROR";
                            d.resolve(response);

                        } else if (stderr) {
                            if (stderr == "")
                                stderr = "Getting mount status...";

                            logger.info('[SYSTEM] - Mount status result (stderr): ' + stderr);
                            response.message = stderr;
                            response.result = "WARNING";
                            d.resolve(response);

                        } else {
                            stdout = stdout.replace(/\n$/, '');
                            logger.info('[SYSTEM] - Mount status result (stdout): ' + stdout);
                            response.message = stdout;
                            response.logs = stdout;
                            response.result = "SUCCESS";
                            d.resolve(response);
                        }

                    }
                    catch(err){
                        response.result = "ERROR";
                        response.message = JSON.stringify(err);
                        logger.error('[SYSTEM] - execAction "' + action + '" error: ' + response.message);
                        d.resolve(response);
                    }

                });
                break;


            case 'mount_ro':

                exec('rootro', function (error, stdout, stderr) {

                    try{

                        if (error) {
                            logger.error('[SYSTEM] - Mount RO result (error): ' + error);
                            response.message = error;
                            response.logs = error.message;
                            response.result = "ERROR";
                            d.resolve(response);

                        } else if (stderr) {
                            if (stderr == "")
                                stderr = "Mounting FS in read-only...";

                            logger.info('[SYSTEM] - Mount RO result (stderr): ' + stderr);
                            response.message = stderr;
                            response.result = "WARNING";
                            d.resolve(response);

                        } else {
                            stdout = stdout.replace(/\n$/, '');
                            logger.info('[SYSTEM] - Mount RO result (stdout): ' + stdout);
                            response.message = stdout;
                            response.result = "SUCCESS";
                            d.resolve(response);
                        }

                    }
                    catch(err){
                        response.result = "ERROR";
                        response.message = JSON.stringify(err);
                        logger.error('[SYSTEM] - execAction "' + action + '" error: ' + response.message);
                        d.resolve(response);
                    }

                });

                break;


            case 'mount_rw':

                exec('rootrw', function (error, stdout, stderr) {

                    try {

                        if (error) {
                            logger.error('[SYSTEM] - Mount RW result (error): ' + error);
                            response.message = error;
                            response.logs = error.message;
                            response.result = "ERROR";
                            d.resolve(response);

                        } else if (stderr) {
                            if (stderr == "")
                                stderr = "Mounting FS in read-write...";

                            logger.info('[SYSTEM] - Mount RW result (stderr): ' + stderr);
                            response.message = stderr;
                            response.result = "WARNING";
                            d.resolve(response);

                        } else {
                            stdout = stdout.replace(/\n$/, '');
                            logger.info('[SYSTEM] - Mount RW result (stdout): ' + stdout);
                            response.message = stdout;
                            response.result = "SUCCESS";
                            d.resolve(response);
                        }

                    }
                    catch(err){
                        response.result = "ERROR";
                        response.message = JSON.stringify(err);
                        logger.error('[SYSTEM] - execAction "' + action + '" error: ' + response.message);
                        d.resolve(response);
                    }

                });
                break;


            case 'pkg_manager':

                try {

                    //var params = JSON.parse(params);
                    logger.info("[SYSTEM] --> parameters:\n" + JSON.stringify(params));

                } catch (err) {

                    response.message = "Error parsing package parameters: " + JSON.stringify(err);
                    response.result = "ERROR";
                    logger.error("[SYSTEM] --> " + response.message);
                    //d.resolve(response);

                }

                var pkg_mng = params["pkg_mng"];
                var pkg_mng_cmd = params["pkg_mng_cmd"];
                var pkg_name = params["pkg_name"];
                var pkg_opts = params["pkg_opts"];

                managePackage(pkg_mng, pkg_mng_cmd, pkg_opts, pkg_name, function (pack) {

                    d.resolve(pack);

                });

                break;


            case 'restart_lr':

                try {

                    var params = JSON.parse(params);

                } catch (err) {
                    logger.debug("[SYSTEM] --> parsing parameters error: " + JSON.stringify(err));

                }

                if (params == null || params == undefined || params == "")
                    var restart_time = 5;
                else {
                    logger.info("[SYSTEM] --> parameters:\n" + JSON.stringify(params, null, "\t"));
                    var restart_time = params["time"];
                    if (restart_time == null || restart_time == undefined || restart_time == "")
                        restart_time = 5;

                }


                try {

                    // activate listener on-exit event after LR exit on-update-conf
                    logger.debug("[SYSTEM] --> Listener on process 'exit' event activated:");
                    logger.debug("[SYSTEM] --> Lightning-rod PID: " + process.pid);
                    process.on("exit", function () {

                        require("child_process").spawn(process.argv.shift(), process.argv, {
                            cwd: process.cwd(),
                            detached: true,
                            stdio: "inherit"
                        });

                    });

                    logger.info('[SYSTEM] - Restarting Lightning-rod in ' + restart_time + ' seconds...');
                    response.message = "Restarting Lightning-rod on board " + boardCode;
                    response.result = "SUCCESS";
                    d.resolve(response);

                    //Restarting LR
                    setTimeout(function () {

                        process.exit();

                    }, restart_time * 1000);

                }
                catch(err){
                    response.result = "ERROR";
                    response.message = JSON.stringify(err);
                    logger.error('[SYSTEM] - execAction "' + action + '" error: ' + response.message);
                    d.resolve(response);
                }

                break;


            case 'rest_submit':

                try {

                    logger.info('[SYSTEM] - REST SUBMITTER CALLED');
                    

                    try {

                        var params = JSON.parse(params);
                        //logger.info("[SYSTEM] --> REST parameters:\n" + JSON.stringify(params, null, "\t"));

                        var res_url = params["res_url"];
                        //logger.info(res_url)
                        logger.info("[SYSTEM] --> REST called: " + JSON.stringify(res_url));

                        var res_method = params["res_method"];
                        var res_body = params["res_body"];
                        var res_headers = params["res_headers"];
                        var res_cookies = params["res_cookies"];
                        var res_auth = params["res_auth"];
                        var res_dataType = params["res_dataType"];
                        var res_timeout = params["res_timeout"];

                    } catch (err) {

                        throw new Error("Parsing parameters error: " + JSON.stringify(err));
                        
                    }


                    requestify.request(res_url, {
                        method: res_method,
                        body: res_body,
                        headers: res_headers,
                        cookies: res_cookies,
                        auth: res_auth,
                        dataType: res_dataType,
                        timeout: res_timeout	
                    }).then(


                        function(res) {

                            //logger.info(res)
                            response.message = {};
                            response.message['body'] = res.getBody();
                            response.message['code'] = res.getCode();
                            response.result = "SUCCESS";

                            //logger.info('[SYSTEM] --> REST result:' + JSON.stringify(response, null, "\t"));
                            //logger.info('[SYSTEM] --> REST executed.');

                            d.resolve(response);

                        }, 
                        function(error) {

                            response.message = {};
                            response.message['body'] = error.getBody();
                            response.message['code'] = error.getCode();
                            response.result = "ERROR";
         
                            //logger.debug('[SYSTEM] --> REST error "' + action + '" error: ' + JSON.stringify(response.message));
                            logger.error('[SYSTEM] --> REST error "' + action + '" error: ' + JSON.stringify(response.message['code']));
                            d.resolve(response);

                        }
                        
                       
                    
                    );
                    

                    

                } catch (err) {
                    response.result = "ERROR";
                    response.message = err.message;
                    response.logs = err.stack
                    logger.error('[SYSTEM] - execAction "' + action + '" error: ' + response.message);
                    d.resolve(response);

                }

                break;   


            case 'plugins_check':

                var options = "no_cli"

                try {

                    var params = JSON.parse(JSON.stringify(params));
                    logger.info("[SYSTEM] --> parameters:\n" + JSON.stringify(params, null, "\t"));

                    options = params["options"];

                } catch (err) {

                    //throw new Error("Parsing parameters error: " + JSON.stringify(err));
                    if (params == null || params == undefined || params == ""){
                        //var options = "no_cli";
                        logger.info("[SYSTEM] --> Parameters not specified!");
                    }
                    else   
                        logger.error("[SYSTEM] --> Parsing parameters error: " + JSON.stringify(err));

                    logger.error("[SYSTEM] --> Set 'no_cli' view.");

                }
   

                exec('pluginsCheck ' + options, function (error, stdout, stderr) {

                    try {

                        if (error) {

                            //logger.error('[SYSTEM] - Plugins status result (error): ' + error);
                            response.message = error;
                            response.logs = error.message;
                            response.result = "ERROR";

                            logger.info('[SYSTEM] - Plugins status result (error): ' + response.result);
                            d.resolve(response);

                        } else if (stderr) {

                            if (stderr == "") stderr = "Getting plugins status...";

                            //logger.info('[SYSTEM] - Plugins status result (stderr): ' + stderr);
                            response.message = stderr;
                            response.result = "WARNING";
                            logger.info('[SYSTEM] - Plugins status result (stderr): ' + response.result);

                            d.resolve(response);

                        } else {
                            //stdout = stdout.replace('\n', '');
                            //logger.info('[SYSTEM] - Plugins status result (stdout): ' + stdout);
                            response.logs = stdout.replace(/\n/g,''); //JSON.parse(JSON.stringify(stdout)).replace(/\n/g,'');
                            response.message = "Plugins status result";
                            response.result = "SUCCESS";

                            logger.info('[SYSTEM] - Plugins status result (stdout): ' + response.result);

                            d.resolve(response);
                        }

                    }
                    catch(err){
                        response.result = "ERROR";
                        response.message = JSON.stringify(err);
                        logger.error('[SYSTEM] - execAction "' + action + '" error: ' + response.message);
                        d.resolve(response);
                    }

                });
                break;


            case 'process_check':

                try {

                    logger.info('[SYSTEM] - PROCESS CHECKER CALLED');

                    var params = JSON.parse(JSON.stringify(params));
                    logger.info("[SYSTEM] --> parameters:\n" + JSON.stringify(params, null, "\t"));

                    var find_process = params["process"];
                    //logger.info("[SYSTEM] --> process filter: " + JSON.stringify(find_process));

                    exec('ps lx | grep ' + find_process + '| grep -v grep ', function (error, stdout, stderr) {
                    
                      try {
                    
                          if (stderr) {
                              
                              //console.info('Check process result (stderr): ' + stderr);
                              response.message = stderr;
                              response.result = "WARNING";
                              d.resolve(response);
                    
                          } else {
                    
                              var processes_list=stdout.split("\n").filter(function(a){return a !== ''})
                              //console.info(processes_list);
                    
                              //processes_list.forEach(function( process ){ console.log(process); });
                    
                              response.message = processes_list;
                              response.logs = processes_list;
                              response.result = "SUCCESS";
                              d.resolve(response);
                    
                          }
                    
                    
                      }
                      catch(err){
                          response.result = "ERROR";
                          response.message = JSON.stringify(err);
                          console.error('[SYSTEM] - execAction error: ' + response.message);
                          d.resolve(response);
                      }
                    
                    });

                } catch (err) {

                    response.result = "ERROR";
                    response.message = err.message;
                    response.logs = err.stack
                    logger.error('[SYSTEM] - execAction "' + action + '" error: ' + response.message);
                    d.resolve(response);

                }         
            
                break;
    
    


            default:

                response.message = "Board operation '" + action + "' not supported!";
                response.result = 'ERROR';
                logger.error("[SYSTEM] - " + response.message);
                d.resolve(response);

                break;

        }

    }
    catch(err){
        response.result = "ERROR";
        response.message = JSON.stringify(err);
        logger.error('[SYSTEM] - execAction "' + action + '" error: ' + response.message);
        d.resolve(response);
    }

    return d.promise;


};




var managePackage = function (pkg_mng, pkg_mng_cmd, pkg_opts, pkg_name, callback) {

    var response = {
        message: '',
        result: ''
    };

    try {

        if (PKG_MNG_SUPPORTED.includes(pkg_mng)) {

            if (pkg_opts == "")
                var install_cmd = pkg_mng + " " + pkg_mng_cmd + " " + pkg_name;
            else
                var install_cmd = pkg_mng + " " + pkg_mng_cmd + " " + pkg_opts + " " + pkg_name;


            if (pkg_mng == "opkg")
                if (pkg_opts == "")
                    var install_cmd = "opkg update && " + pkg_mng + " " + pkg_mng_cmd + " " + pkg_name;
                else
                    var install_cmd = "opkg update && " + pkg_mng + " " + pkg_mng_cmd + " " + pkg_opts + " " + pkg_name;

            if (pkg_mng == "apt" || pkg_mng == "apt-get")
                if (pkg_opts == "")
                    var install_cmd = pkg_mng + " update && " + pkg_mng + " " + pkg_mng_cmd + " " + pkg_name;
                else
                    var install_cmd = pkg_mng + " update && " + pkg_mng + " " + pkg_mng_cmd + " " + pkg_opts + " " + pkg_name;


            logger.debug("[SYSTEM] --> cmd: " + install_cmd);


            exec(install_cmd, function (error, stdout, stderr) {

                if (error) {

                    var error_msg = error.message;

                    logger.error('[SYSTEM] - Package manager result (error):\n' + error);

                    if (pkg_mng == "apt-get" || pkg_mng == "apt") {
                        var final_result = error_msg.split("\n");
                        response.message = final_result[final_result.length - 2].trim();
                    } else if (pkg_mng == "pip") {
                        var final_result = error_msg.split("\n");
                        response.message = final_result[final_result.length - 2].trim();
                    } else if (pkg_mng == "opkg") {
                        var final_result = error_msg.split("\n");
                        response.message = final_result[final_result.length - 2].trim();
                    } else {
                        var final_result = error_msg.split("\n");
                        response.message = final_result[1];
                        //response.message = error;
                    }

                    response.logs = error_msg;
                    response.result = "ERROR";

                    callback(response);

                }
                else if (stderr) {

                    if (pkg_mng == "apt-get" || pkg_mng == "apt") {
                        var final_result = stderr.split("\n");
                        response.message = final_result[final_result.length - 2].trim();
                        response.result = "SUCCESS";
                    } else if (pkg_mng == "pip") {
                        var final_result = stderr.split("\n");
                        response.message = final_result[final_result.length - 2].trim();
                        response.result = "WARNING";
                    } else if (pkg_mng == "opkg") {
                        var final_result = stderr.split("\n");
                        response.message = final_result[final_result.length - 2].trim();
                        response.result = "SUCCESS";
                    } else {
                        response.message = stderr;
                        response.result = "SUCCESS";
                    }

                    logger.warn('[SYSTEM] - Package manager result (stderr):\n' + stderr);
                    response.logs = stderr;

                    callback(response);
                }
                else if (stdout) {

                    //stdout = stdout.replace(/\n$/, '');

                    if (pkg_mng == "apt-get" || pkg_mng == "apt") {
                        var final_result = stdout.split("\n");
                        response.message = final_result[final_result.length - 2].trim();
                    } else if (pkg_mng == "pip") {
                        var final_result = stdout.split("\n");
                        response.message = final_result[final_result.length - 2].trim();
                    } else if (pkg_mng == "opkg") {
                        var final_result = stdout.split("\n");
                        response.message = final_result[final_result.length - 2].trim();
                    } else {
                        response.message = stdout;
                    }

                    logger.info('[SYSTEM] - Package manager result (stdout):\n' + stdout);
                    response.logs = stdout;
                    response.result = "SUCCESS";

                    callback(response);

                }

            });

        }
        else {
            response.message = "Package manager '" + pkg_mng + "' not supported!";
            response.result = "ERROR";
            logger.warn('[SYSTEM] - ' + response.message);
            callback(response);
        }

    }
    catch(err){
        response.result = "ERROR";
        response.message = JSON.stringify(err);
        logger.error('[SYSTEM] - managePackage error: '+response.message);
        callback(response);
    }


};


exports.getLRversion = function () {

    try {
        NPM_CONF = process.env.LIGHTNINGROD_HOME + '/package.json';
        npm_conf = require('nconf');
        npm_conf.file({file: NPM_CONF});
        lr_v = npm_conf.get('version');
    }
    catch(err){
        logger.error('[SYSTEM] - getLRversion error: ' + JSON.stringify(err));
        lr_v = "N/A"
    }
    return lr_v;

};


// Login to Crossbar server and to Iotornic
exports.IotronicLogin = function (session) {

    board_session = session;

    session.register('s4t.' + session._id + '.board.checkRegistrationStatus', exports.checkRegistrationStatus);

    manage_WAMP_connection(session)

};


exports.exportManagementCommands = function (session, callback) {

    //Register all the module functions as WAMP RPCs
    logger.info('[WAMP-EXPORTS] Management commands exported to the cloud!');
    session.register('s4t.' + boardCode + '.board.setBoardPosition', exports.setBoardPosition);
    session.register('s4t.' + boardCode + '.board.execAction', exports.execAction);
    session.register('s4t.' + boardCode + '.board.updateConf', exports.updateConf);
    session.register('s4t.' + boardCode + '.board.updateLR', exports.updateLR);

};

