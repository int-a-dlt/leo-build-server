let express = require('express')
let router = express.Router()
let {UserTable} = require('../models/model.js')
let asyncHandler = require('express-async-handler')
// let conection = require('../utils/mysql')
// let path = require('path')
// let http = require('http')
// let fs = require('fs')
// let querystring = require('querystring')
// let request = require('request')
// let Sequelize = require('sequelize')

router.get('/index', asyncHandler(async function(req, res, next){
  let Users = await UserTable.findAll()
  res.render('index', {Users})
}))
module.exports = router