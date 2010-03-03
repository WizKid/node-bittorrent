var fs = require("fs");
var sys = require("sys");
var tcp = require("tcp");
var bittorrent = require("./lib/bittorrent");

// Create client and start listening on port 80.
var client = new bittorrent.Client();
client.listen(80, "localhost");

// Load a torrent and add it to the client
var t = new bittorrent.Torrent("test.torrent", ".");
t.load(function(err) {
    if (err) throw err;
    client.addTorrent(t);
});
