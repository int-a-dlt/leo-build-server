
let debug = require('../utils/debug.js')
// 自定义debug样式
let config = require('../config')
let JWT = require('jsonwebtoken')
// 对IO中间件进行openid验证
// let asyncHandler = require('express-async-handler')
// express 中对async函数进行包装，以便错误中间件捕获错误
let {UserTable} = require('../models/model.js')
let IO = require('socket.io')
// 工具类函数
let LEO = {
  get_openid: async function (token) {
    return new Promise((resolve, reject) => {
      JWT.verify(token, config.secret_key, function (err, decoded) {
        if (err) {
          debug.error('authentication error')
          reject(new Error('authentication error'))
        } else {
          resolve(decoded.openid)
        }
      })
    })
  }
}

function GameHub () {
  this.rooms = []
  this.online_clients = []
  this.matching_clients = []
}

GameHub.prototype.getdefaultoptions = function () {
  return {
    path: '/user',
    serveClient: false,
    pingInterval: 10000,
    pingTimeout: 5000,
    cookie: false
  }
}

GameHub.prototype.verify_token = function (IO) {
  IO.use((socket, next) => {
    let {token} = socket.handshake.query
    JWT.verify(token, config.secret_key, (err, decoded) => {
      if (err) {
        debug.error('authentication error')
        return next(new Error('authentication error'))
      } else {
        return next()
      }
    })
  })
}

GameHub.prototype.send_to = function (openid, msg = 'one-to-one message') {
  this.online_clients.forEach((item) => {
    if (item.openid === openid) {
      console.log('find')
      item.socket.emit('private_msg', {openid, msg})
    }
  })
}

GameHub.prototype.del_online_client_byid = function (id = '') {
  this.online_clients.forEach((item, index) => {
    if (item.socket.id === id) {
      this.online_clients.splice(index, 1)
    }
  })
}

GameHub.prototype.del_matching_client_byid = function (id = '') {
  this.matching_clients.forEach((item, index) => {
    if (item.socket.id === id) {
      this.matching_clients.splice(index, 1)
    }
  })
}

GameHub.prototype.find_client_byid = function (id = '') {
  let client = null
  this.online_clients.forEach((item, index) => {
    if (item.openid === id) {
      client = item
    }
  })
  if (client) {
    return client
  } else {
    return false
  }
}

GameHub.prototype.run_match_system = function (clients) {
  setInterval(() => {
    if (clients.length >= 2) {
      let matchingLength = clients.length % 2 === 0 ? clients.length : clients.length - 1
      console.log(matchingLength)
      for (let i = 0; i < matchingLength / 2; i++) {
        let VS1 = {
          openid: clients[2 * i].openid,
          nickname: clients[2 * i].nickname,
          socketid: clients[2 * i].socket.id,
          avatar: clients[2 * i].avatar
        }
        let VS2 = {
          openid: clients[2 * i + 1].openid, 
          nickname: clients[2 * i + 1].nickname,
          socketid: clients[2 * i + 1].socket.id,
          avatar: clients[2 * i + 1].avatar
        }
        let VSdata = [VS1, VS2]
        clients[2 * i].socket.emit('matched', VSdata)
        clients[2 * i + 1].socket.emit('matched', VSdata)
      }
      clients.splice(0, matchingLength)
      console.log('匹配了' + matchingLength + '人,还剩', this.matching_clients.length)
    } else {
      if (clients.length) {
        clients[0].socket.emit('match_failed')
        clients.splice(0, 1)
      }
    }
  }, 12000)
}

GameHub.prototype.run_beat_system = function () {
  setInterval(() => {
    this.io.of('/user').emit('beat_req')
  }, 60000)
}
GameHub.prototype.get_room_info = function (namespace, roomname) {
  let roomarr
  this.io.of(namespace).in(roomname).clients((err, client) => {
    if (!err) {
      let clientobj = this.find_client_byid(client)
      roomarr.push({
        openid: clientobj.openid,
        socketid: clientobj.socket.id,
        nickname: clientobj.nickname,
        avatar: clientobj.avatar
      })
    }
  })
  return roomarr
}

GameHub.prototype.init = function (httpserver, options) {
  let opts = options || this.getdefaultoptions()

  this.io = IO(httpserver)
  this.verify_token(this.io)
  this.run_match_system(this.matching_clients)
  this.run_beat_system(this.online_clients)

  this.io.of('/user').on('connection', async (socket) => {
    let openid = await LEO.get_openid(socket.handshake.query.token)
    if (!openid) {
      socket.emit('system_info', 'authentication error')
      return
    }
    let {nickname, avatar} = await UserTable.findOne({where: { openid }})
    debug.log('connected', socket.id, ' ', this.online_clients.length)

    socket.on('beat_res', function () {
      console.log('beat_res')
    })
    let socket_obj = {
      socket,
      openid,
      nickname,
      avatar
    }
    socket.on('need_match', () => {
      debug.success(socket.id, ' need_match')
      this.matching_clients.push(socket_obj)
      debug.success('matching-length:', this.matching_clients.length)
    })

    socket.on('cancel_match', () => {
      console.log(socket.id, ' cancel_match')
      this.del_matching_client_byid(socket.id)
      console.log(this.matching_clients.length)
    })

    socket.on('disconnect', () => {
      console.log(socket.id, ' 断开连接')
      this.del_online_client_byid(socket.id)
      console.log('还有', this.online_clients.length)
    })

    socket.on('update_score', (data) => {
      let {score, openid} = data
      this.send_to(openid, score)
    })
    socket.on('join_room', (roominfo) => {
      socket.join(roominfo.room)
      // socket.to(roominfo.room).emit('join_info', 'someone joined')
      let room_info = this.get_room_info('/user', roominfo.room)
      console.log(room_info)
      socket.in(roominfo.room).emit('join_info', room_info)
    })
    socket.on('exit_room', (roominfo) => {
      socket.leave(roominfo.room)
      if (roominfo.init) {
        socket.to(roominfo.room).emit('exit_info', {init: true})
      } else {
        socket.to(roominfo.room).emit('exit_info', {init: false, socketid: socket.id})
      }
    })
    this.online_clients.push(socket_obj)
  })
}

module.exports = new GameHub()