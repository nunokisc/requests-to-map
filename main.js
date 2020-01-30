const express = require('express');
const fileUpload = require('express-fileupload');
const cors = require('cors');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const _ = require('lodash');
const app = express();
var path = require('path');
var fs = require('fs');
var async = require("async");
var request = require('request');
var http = require('http').createServer(app);
var io = require('socket.io')(http);

//start app 
const port = process.env.PORT || 3000;

const uploadsFolder = './uploads/';
const resultsFolder = './results/';
const resultsWGeoFolder = './results_with_geo/';

const geoIpSources = ['https://freegeoip.app/json/', 'https://ipvigilante.com/', 'https://www.iplocate.io/api/lookup/']

// enable files upload
app.use(fileUpload({
    createParentPath: true
}));

//add other middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

//app.use(express.static('uploads'));

app.get('/', function (req, res) {
    res.sendFile(path.join(__dirname + '/index.html'));
});

app.get('/getFilesGeoProcessed', function (req, res) {
    let files = []
    fs.readdirSync(resultsWGeoFolder).forEach(file => {
        files.push(file);
    });
    res.json(files)
})

app.get('/getFilesToProcess', function (req, res) {
    let files = []
    fs.readdirSync(uploadsFolder).forEach(file => {
        if(file != '.gitkeep')
            files.push(file);
    });
    res.json(files)
})

app.get('/getFilesToGeoProcess', function (req, res) {
    let files = []
    fs.readdirSync(resultsFolder).forEach(file => {
        files.push(file);
    });
    res.json(files)
})

app.get('/getGeoIpSources', function (req, res) {
    res.json(geoIpSources)
})

app.get('/getRequestMap', function (req, res) {
    let requestedMap = fs.readFileSync(resultsWGeoFolder + req.query.requestMap);
    let mapPoints = JSON.parse(requestedMap);
    res.json(mapPoints)
})

app.post('/upload-access-log', async (req, res) => {
    try {
        if (!req.files) {
            res.send({
                status: false,
                message: 'No file uploaded'
            });
        } else {
            //Use the name of the input field (i.e. "avatar") to retrieve the uploaded file
            let accessLog = req.files.accessLog;

            //Use the mv() method to place the file in upload directory (i.e. "uploads")
            let accessLogName = accessLog.name.split('.').slice(0, -1).join('.') + '_' + Math.floor(Date.now() / 1000);
            let accessLogExt = accessLog.name.substr(accessLog.name.lastIndexOf("."));
            //console.log(accessLogName)
            //console.log(accessLogExt)
            accessLog.mv('./uploads/' + accessLogName + accessLogExt);

            //send response
            res.send({
                status: true,
                message: 'File is uploaded',
                data: {
                    name: accessLogName + accessLogExt,
                    mimetype: accessLog.mimetype,
                    size: accessLog.size
                }
            });
        }
    } catch (err) {
        console.log(err)
        res.status(500).send(err);
    }
});

io.on('connection', function (socket) {
    console.log('a user connected');
    socket.join(socket.handshake.query.token);
    socket.on('accessProcess', function (val) {
        console.log('accessProcess: ' + val);
        var ips = [];
        var ips_temp = [];
        processAccessFile(fs.createReadStream(uploadsFolder + val), function (done, data) {
            //console.log(data.split(' ')[0])
            if (done !== null) {
                console.log("end")
                //console.log(ips.length)
                fs.writeFile(resultsFolder + val.split('.').slice(0, -1).join('.') + ".json", JSON.stringify(ips), function (err) {
                    console.log("write to file " + resultsFolder + val.split('.').slice(0, -1).join('.') + ".json")
                });
            } else {
                if (ips_temp.includes(data.split(' ')[0])) {
                    ips[ips_temp.indexOf(data.split(' ')[0])][3] += 1;
                    //console.log("existe")
                }
                else {
                    ips_temp.push(data.split(' ')[0])
                    ips.push([0, 0, data.split(' ')[0], 1])
                    //console.log("n existe")
                }
            }
        });
    });
    socket.on('accessGeoProcess', function (val) {
        console.log('accessGeoProcess: ' + val);
        processGeoAccessFile(val.token, val.geoSource, val.file);
    });
    socket.on('disconnect', function () {
        console.log('user disconnected');
    });
});

http.listen(port, () => console.log(`listening on *: ${port}!`))

function processAccessFile(input, func) {
    var remaining = '';

    input.on('data', function (data) {
        remaining += data;
        var index = remaining.indexOf('\n');
        while (index > -1) {
            var line = remaining.substring(0, index);
            remaining = remaining.substring(index + 1);
            func(null, line);
            index = remaining.indexOf('\n');
        }
    });

    input.on('end', function () {
        if (remaining.length > 0) {
            func(null, remaining);
        }
        func("end", null);
    });
}

function processGeoAccessFile(token, geoSource, fileName) {
    var number = 0;
    var processed = require(resultsFolder + fileName);
    var processedSize = processed.length;
    var aux = 0;
    //console.log(processed)
    async.mapSeries(processed, function (data, next) {
        number++;
        if (Math.floor(100 * number / processedSize) == aux) {
            io.to(token).emit("accessGeoProcessPercentage", aux);
            aux++;
        }
        request(geoIpSources[geoSource] + data[2], function (error, response, body) {
            if (!error && response.statusCode == 200) {
                let geo = JSON.parse(body);
                data[0] = geo.latitude;
                data[1] = geo.longitude;
                //console.log(number)
                next(null, data);
            }
            else {
                console.log("err")
                console.log(error)
                console.log(response.statusCode)
                next(null, data);
            }
        });
    }, function (err, geoProcessed) {
        console.log("end")
        //console.log(err)
        //console.log(geoProcessed)
        fs.writeFile(resultsWGeoFolder + fileName.split('.').slice(0, -1).join('.') + "_geo" + ".json", JSON.stringify(geoProcessed), function (err) {
            console.log("write to file " + resultsWGeoFolder + fileName.split('.').slice(0, -1).join('.') + "_geo" + ".json")
            io.to(token).emit("refreshView", "multiRequestMap");
        });
    })
}
