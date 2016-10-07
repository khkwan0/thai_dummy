var app = require('express')();
var session = require('express-session');
var redis = require('redis');
var http = require('http').Server(app);
var io = require('socket.io')(http);
var fs = require('fs');
var path = require('path');
var uuid = require('uuid');
var passport = require('passport'),
    FaceBookStrategy = require('passport-facebook').Strategy,
    LineStrategy = require('passport-line').Strategy;
var RedisStore = require('connect-redis')(session);
var config = require('./config');

rooms = {
    'lobby': {
        players: [],
    },
    '1': {
        players: [],
        time_limit: 40,
        multiplier: 1,
        seats: 3,
        cards: [],
        discard: [],

    }
};

function shuffle(room_id) {
    console.log('SHUFFLE:'+room_id);
    rooms[room_id].cards = [];
    for (let i=0; i< 52; i++) {
        rooms[room_id].cards.push(i);
    }
    for (let i=51; i>=0; i--) {
        j = Math.floor(Math.random() * 52);
        temp = rooms[room_id].cards[i];
        rooms[room_id].cards[i] = rooms[room_id].cards[j];
        rooms[room_id].cards[j] = temp;
    }
}

function deal(room_id) {
    num_players = rooms[room_id].players.length;
    to_deal = 11-((num_players-2)*2);
    for (i=0; i<to_deal; i++) {
        rooms[room_id].players.forEach(function(player) {
            if (typeof player.cards === 'undefined') {
                player.cards = [];
            }
            player.cards.push(rooms[room_id].cards.shift());
        });
    }
    console.log(rooms[room_id].players[0].cards);
}

function getFromCards(room_id, player) {
    if (rooms[room_id].cards.length>0) {
        player.cards.push(rooms[room_id].cards.shift());
    }
}

function sendToDiscard(room_id, player, card) {
    rooms[room_id].discard.push(card);
}

function meld(room_id, player, cards) {
    rooms[room_id].players[0].meld.push(cards);
}

function removeCard(player, card) {
}

function removeCardFromHand(room_id, player, cards) {
    cards.forEach(function(card) {
        removeCard(player, card);
    });
}

app.use(session({
        store: new RedisStore({
            host: 'localhost',
            port: 6379,
            db: 1
        }),
        resave: false,
        saveUninitialized: false,
        secret: config.session.secret})
);

passport.use(new FacebookStrategy({
        clientID: config.facebook.clientID,
        clientSecret: config.facebook.clientSecret,
        callbackURL: 'https://siamdummy.com/auth/facebook/callback',
        profileFields: ['id', 'photos', 'emails']
    },
    function (successToken, refreshToken, profile, done) {
        email = profile.emails[0].value;
        redis_client.get(email, function(err, data) {
            if (err) {
                return done(err);
            }
            if (data) {
                user = JSON.parse(data);
                if (typeof user.profile === 'undefined') {
                    user.profile = {};
                }
                if (typeof user.profile.fb === 'undefined') {
                    user.profile.fb = profile;
                }
                redis_client.set(email, JSON.stringify(user), function(err) {
                    if (err) {
                        throw(err);
                    }
                    done(null, user);
                });
            } else { 
                var new_user = {
                    'email': email,
                    'datetime': Date.now() ,
                    'profile': {fb:profile}
                }
                redis_client.set(email, JSON.stringify(new_user), function(err) {
                    if (err) {
                        throw(err);
                    }
                    return done(null, new_user);
                });
            }
        });
    }
));

http.listen(9000);
app.get('/', function(req, res) {
    res.sendFile(path.join(__dirname + '/front.html'));
});

io.on('connection', function(socket) {
    player = {
        id: uuid.v4(),
        locale: 'lobby'
    };
    socket.on('login', function(msg) {
        player.name = msg,
        socket.join('lobby');
        console.log(msg);
        if (typeof rooms.lobby === 'undefined') {
            rooms.lobby = {};
            rooms.lobby.players = [];
        };
        rooms.lobby.players.push(player);
        socket.emit('update', JSON.stringify(rooms));
    });
    socket.on('create_room', function(msg) {
        room_id = msg;
        if (typeof rooms[rooms_id] !== 'undefined') {
            console.log('cannot creat a room which alrady exists');
        } else {
            rooms[room_id] = {
                multiplier: 1,
                time_limit: 40,  // seconds
                seats: 3,
                players: []
            };
            rooms[room_id].players.push(player);
            socket.leave('lobby');
            socket.join(room_id);
        }
    });
    socket.on('join', function(msg) {
        console.log(msg);
        room_id = msg;
        socket.leave('lobby');
        socket.join(room_id);
        rooms[room_id].id = room_id;
        socket.emit('update_room', JSON.stringify(rooms[room_id]));
    });
    socket.on('sit', function(msg) {
        room_id = msg;
        if (rooms[room_id].players.length < 4) {
            rooms[room_id].players.push(player);
        }

    });
    socket.on('leave', function(msg) {
        socket.leave(room_id);
        socket.join('lobby');
    });
    socket.on('start', function(msg) {
        room_id = msg;
        console.log('start', room_id);
        shuffle(room_id);
        console.log(rooms[room_id].cards);
        deal(room_id);
        console.log(rooms[room_id].cards);
    });
});
