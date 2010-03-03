var events = require("events");
var fs = require("fs");
var tcp = require("tcp");

var bencode = require("./bencode");
var sys = require("sys");
var crypto = require("../../node-crypto/crypto");


function bind(scope, func) {
    var _function = func;
    return function() {
        return _function.apply(scope, arguments);
    }
}

function Request(index, begin, length) {
    this.index = index;
    this.begin = begin;
    this.length = length;
}

function Client() {
    this.torrents = {};
    this.peers = [];

    this.peerId = "-NJ0001-";
    while (this.peerId.length < 20)
        this.peerId += String.fromCharCode(Math.random()*256);

    var self = this;
    this.server = tcp.createServer(function(socket) {
        sys.puts("Client connected");
        self.addPeer(socket);
    });
}

Client.prototype = {
    addPeer: function(socket) {
        this.peers.push(new Peer(socket, this));
    },
    removePeer: function(peer) {
        sys.puts("Remove peer from this.peers");
    },
    listen: function(port, ip) {
        this.server.listen(port, ip || "localhost");
    },
    addTorrent: function(torrent) {
        this.torrents[torrent.infoHash] = torrent;
    },
    hasTorrent: function(infoHash) {
        return this.torrents[infoHash] != undefined;
    },
    getTorrent: function(infoHash) {
        return this.torrents[infoHash];
    }
}

function Peer(socket, client) {
    this.socket = socket;
    this.client = client;

    this.inHandshake = true;
    this.infoHash = null;
    this.peerId = null;
    this.buffer = "";
    this.queue = [];
    this.drained = true;
    this.sending = false;

    this.socket.setEncoding("binary");
    this.socket.addListener("connect", this.onConnect);
    this.socket.addListener("data", bind(this, this.onData));
    this.socket.addListener("end", bind(this, this.onEnd));
    this.socket.addListener("drain", bind(this, this.onDrain));
}

Peer.prototype = {
    onConnect: function() {
        sys.puts("CONNECT!");
    },
    readInt: function(data, offset) {
        return (data.charCodeAt(offset + 0) << 24) +
               (data.charCodeAt(offset + 1) << 16) +
               (data.charCodeAt(offset + 2) << 8) +
               (data.charCodeAt(offset + 3));
    },
    writeInt: function(data) {
        return String.fromCharCode((data >> 24) & 0xff) +
               String.fromCharCode((data >> 16) & 0xff) +
               String.fromCharCode((data >> 8) & 0xff) +
               String.fromCharCode((data) & 0xff);
    },
    disconnect: function(msg) {
        sys.puts("Disconnect: "+ msg);
        this.socket.close();
        this.client.removePeer(this);
    },
    handleHandshake: function(data) {
        this.inHandshake = false;

        if (data.length < 48 || data.substr(0, 20) != "\x13BitTorrent protocol") {
            this.disconnect("Strange handshake: "+ data);
            return;
        }

        this.infoHash = data.substr(28, 20);
        if (!this.client.hasTorrent(this.infoHash)) {
            this.disconnect("Torrent don't exists: "+ this.infoHash);
            return;
        }

        // Say hi
        var response = "\x13BitTorrent protocol\x00\x00\x00\x00\x00\x00\x00\x00"+ this.infoHash + this.client.peerId;
        this.socket.write(response);

        if (data.length < 68) {
            this.disconnect("No peerId so this was probably a tracker checking in");
            return;
        }

        this.peerId = data.substr(48, 20);

        // Tell the peer that we have all pieces
        var bitfield = "";
        var i = 0;
        var pieces = 963;
        for (; i < Math.floor(pieces / 8); i++)
            bitfield += "\xff";
        var left = pieces % 8;
        var lastbyte = 0;
        for (var j = 0; j < left; j++)
            lastbyte = (lastbyte << 1) + 1;
        lastbyte = lastbyte << 8 - left;
        bitfield += String.fromCharCode(lastbyte);
        response = this.writeInt(1 + bitfield.length) +"\x05"+ bitfield;
        for (var j = 0; j < response.length; j++)
            sys.puts(j +": "+ response.charCodeAt(j));
        this.socket.write(response);

        // Unchoke the peer
        this.socket.write("\x00\x00\x00\x01\x01");
    },
    onData: function(data) {
        sys.puts("onData");
        if (this.inHandshake) {
            this.handleHandshake(data);
            return;
        }

        sys.puts("Handle data: "+ data.length);
        this.buffer += data;
        if (this.buffer.length < 4) {
            sys.puts("Buffer: "+ this.buffer.length);
            return;
        }

        var len = this.readInt(this.buffer, 0);
        sys.puts("Length: "+ len);
        if (len != 0) {
            switch (this.buffer[4]) {
                case "\x00":
                    // choke
                    sys.puts("choke");
                    break;
                case "\x01":
                    // unchoke
                    sys.puts("unchoke");
                    break;
                case "\x02":
                    // interested
                    sys.puts("interested");
                    break;
                case "\x03":
                    // not interested
                    sys.puts("not interested");
                    break;
                case "\x04":
                    // have
                    sys.puts("have");
                    break;
                case "\x05":
                    // bitfield
                    sys.puts("bitfield");
                    break;
                case "\x06":
                    // request
                    sys.puts("request");
                    this.queue.push(new Request(this.readInt(this.buffer, 5), this.readInt(this.buffer, 9), this.readInt(this.buffer, 13)));
                    this.handleRequest();
                    break;
                case "\x07":
                    // piece
                    sys.puts("piece");
                    break;
                case "\x08":
                    // cancel
                    sys.puts("cancel");
                    break;
                case "\x09":
                    // port
                    sys.puts("port");
                    break;
                default:
                    this.disconnect("Unknown message: "+ this.buffer.charCodeAt(4));
                    break;
            }
        }

        if (this.buffer.length == len + 4) {
            this.buffer = "";
        } else {
            this.buffer = this.buffer.substr(4 + len);
            this.onData("");
        }
    },
    handleRequest: function() {
        sys.puts("handleRequest: "+ this.queue.length +", "+ this.sending);
        if (this.queue.length == 0 || this.sending) // || !this.drained
            return;

        this.drained = false;
        this.sending = true;
        var request = this.queue.shift();

        sys.puts("handleRequest: "+ request.index +", "+ request.begin +", "+ request.length);

        var torrent = this.client.getTorrent(this.infoHash);
        var self = this;
        torrent.read(request.index, request.begin, request.length, function(err, data) {
            if (err) return;

            sys.puts("Send piece");
            self.socket.write(self.writeInt(9 + request.length) +"\x07"+ self.writeInt(request.index) + self.writeInt(request.begin) + data);
            self.sending = false;
                self.handleRequest();
        });
    },
    onEnd: function() {
        sys.puts("END");
        this.disconnect("Connection closed");
    },
    onDrain: function() {
        sys.puts("DRAIN: "+ this.socket.readyState);
        this.drained = true;
        this.handleRequest();
    }
}

function File(path, bytes) {
    this.path = path;
    this.bytes = bytes;
    this.fp = null;
}

File.prototype = {
    check: function(callback) {
        var promise = new events.Promise();
        fs.stat(this.path, function(err, stat) {
            if (err) {
                callback(err);
                return;
            }

            if (stat.size == this.bytes)
                callback(null);
            else
                callback("File size differs from what it should be");
        });
    },
    getFp: function(callback) {
        if (this.fp) {
            callback(null, this.fp);
        } else {
            var self = this;
            fs.open(this.path, process.O_RDONLY, 0666, function(err, fp) {
                if (err) {
                    callback(err);
                    return;
                }

                self.fp = fp;
                callback(null, fp);
            });
        }
    },
    read: function(begin, length, callback) {
        sys.puts("read: "+ begin +", "+ length);
        this.getFp(function(err, fp) {
            if (err) {
                callback(err);
                return;
            }

            fs.read(fp, length, begin, "binary", function(err, data) {
                if (err) {
                    callback(err);
                    return;
                }

                callback(null, data);
            });
        });
    }
}

function Torrent(torrentPath, rootPath) {
    this.torrentPath = torrentPath;
    this.rootPath = rootPath;
    this.files = [];
    this.pieceLength = 0;
    this.pieces = 0;
    this.infoHash = null;
}

Torrent.prototype = {
    load: function(callback) {
        // Load the torrent file and check the data in it
        var self = this;
        fs.readFile(this.torrentPath, "binary", function(err, data) {
            if (err) {
                callback(err);
                return;
            }

            var torrentObj;
            try {
                torrentObj = bencode.decode(data);
            } catch (err) {
                callback(err);
                return;
            }

            self.loadData(torrentObj, callback);
        });
    },
    loadData: function(torrentObj, callback) {
        var info = torrentObj.info;
        this.infoHash = (new crypto.Hash).init("sha1").update(bencode.encode(info)).digest();
        sys.puts("infoHash.length: "+ this.infoHash.length);
        this.pieceLength = info['piece length'];
        this.pieces = info['pieces'].length / 20;

        // Check if it is multi file mode
        if (info.files != undefined) {
            for (var i in info.files) {
                var file = info.files[i];
                this.files.push(new File(this.rootPath +"/"+ file.path.join("/"), file.length));
            }
        } else {
            this.files.push(new File(this.rootPath +"/"+ info.name, info.length));
        }

        // Should verify that the file exists and have the right amount
        // of bytes. Maybe even check pieces sha1
        // Use File.check() for size check
        callback(null);
    },
    read: function(index, begin, length, callback) {
        var startbyte = 0;
        for (var i in this.files) {
            var file = this.files[i];
            if (startbyte + file.bytes > index * this.pieceLength + begin) {
                // Now we know the first file that we should get data from.
                // If the torrent have several files we need to handle pieces that
                // stretches over several files
                sys.puts("Will read from: "+ file.path);
                file.read(index * this.pieceLength - startbyte + begin, length, callback);
                return;
            }
            startbyte += file.bytes;
        }

        callback("Couldn't find file containing the piece");
    }
}

exports.Torrent = Torrent;
exports.Client = Client;
