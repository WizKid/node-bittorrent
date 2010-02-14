var assert = require("assert");
var bencode = require("./../../lib/bencode");

// Test success
[
    [
        "apa",
        "3:apa"
    ],
    [
        17,
        "i17e"
    ],
    [
        -4711,
        "i-4711e"
    ],
    [
        [1,2],
        "li1ei2ee"
    ],
    [
        {"a": 8, "b": 7},
        "d1:ai8e1:bi7ee"
    ],
    [
        {"a": [1, {"b": 19}]},
        "d1:ali1ed1:bi19eeee"
    ],
    [
        {1: "a", 38: "b"},
        "d1:11:a2:381:be"
    ],
    [
        {"cow": "moo", "spam": "eggs"},
        "d3:cow3:moo4:spam4:eggse"
    ],
    [
        {"spam": ["a", "b"]},
        "d4:spaml1:a1:bee"
    ]
].forEach(function(comp) {
    assert.deepEqual(comp[0], bencode.decode(comp[1]));
    assert.deepEqual(comp[1], bencode.encode(comp[0]));
    assert.deepEqual(comp[0], bencode.decode(bencode.encode(comp[0])));
    assert.deepEqual(comp[1], bencode.encode(bencode.decode(comp[1])));
});

// Test encoding fail
[
    1.3,
].forEach(function(comp) {
    assert.throws(function() { bencode.encode(comp) });
});

// Test decoding fail
[
    "i18",
    "",
    "i18ei132e",
    "di2e1:ai3e1:be"
].forEach(function(comp) {
    assert.throws(function() { bencode.decode(comp) });
});
