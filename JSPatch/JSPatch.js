var global = this

;(function() {

  var _ocCls = {};
  var _jsCls = {};

  var _formatOCToJS = function(obj) {//这个方法用于将 js 端接收到的 OC 对象转换为 js 对象：
    if (obj === undefined || obj === null) return false
    if (typeof obj == "object") {
      if (obj.__obj) return obj
      if (obj.__isNil) return false
    }
    if (obj instanceof Array) {
      var ret = []
      obj.forEach(function(o) {
        ret.push(_formatOCToJS(o))
      })
      return ret
    }
    if (obj instanceof Function) {
        return function() {
            var args = Array.prototype.slice.call(arguments)
            var formatedArgs = _OC_formatJSToOC(args)
            for (var i = 0; i < args.length; i++) {
                if (args[i] === null || args[i] === undefined || args[i] === false) {
                formatedArgs.splice(i, 1, undefined)
            } else if (args[i] == nsnull) {
                formatedArgs.splice(i, 1, null)
            }
        }
        return _OC_formatOCToJS(obj.apply(obj, formatedArgs))
      }
    }
    if (obj instanceof Object) {
      var ret = {}
      for (var key in obj) {
        ret[key] = _formatOCToJS(obj[key])
      }
      return ret
    }
    return obj
  }
  
  var _methodFunc = function(instance, clsName, methodName, args, isSuper, isPerformSelector) {
    var selectorName = methodName
    if (!isPerformSelector) {
      methodName = methodName.replace(/__/g, "-")
      selectorName = methodName.replace(/_/g, ":").replace(/-/g, "_")
      var marchArr = selectorName.match(/:/g)
      var numOfArgs = marchArr ? marchArr.length : 0
      if (args.length > numOfArgs) {
        selectorName += ":"
      }
    }
    var ret = instance ? _OC_callI(instance, selectorName, args, isSuper):
                         _OC_callC(clsName, selectorName, args)
    return _formatOCToJS(ret)
  }

  var _customMethods = { //_customMethods是字典对象，存 __c: function
    __c: function(methodName) {//__c类似于构建了js的全局转发函数，因为在oc里面会把所有的js函数用__c包含住
      var slf = this

      if (slf instanceof Boolean) {
        return function() {
          return false
        }
      }
      if (slf[methodName]) {
        return slf[methodName].bind(slf);
      }

      if (!slf.__obj && !slf.__clsName) {
        throw new Error(slf + '.' + methodName + ' is undefined')
      }
      if (slf.__isSuper && slf.__clsName) {
          slf.__clsName = _OC_superClsName(slf.__obj.__realClsName ? slf.__obj.__realClsName: slf.__clsName);
      }
      var clsName = slf.__clsName
      if (clsName && _ocCls[clsName]) {
        var methodType = slf.__obj ? 'instMethods': 'clsMethods'
        if (_ocCls[clsName][methodType][methodName]) {
          slf.__isSuper = 0;
          return _ocCls[clsName][methodType][methodName].bind(slf)
        }
      }

      return function(){//__c function返回值又是一个匿名函数-闭包，闭包里面访问外包的_methodFunc方法
        var args = Array.prototype.slice.call(arguments)
        return _methodFunc(slf.__obj, slf.__clsName, methodName, args, slf.__isSuper)
      }
    },

    super: function() {
      var slf = this
      if (slf.__obj) {
        slf.__obj.__realClsName = slf.__realClsName;
      }
      return {__obj: slf.__obj, __clsName: slf.__clsName, __isSuper: 1}
    },

    performSelectorInOC: function() {
      var slf = this
      var args = Array.prototype.slice.call(arguments)
      return {__isPerformInOC:1, obj:slf.__obj, clsName:slf.__clsName, sel: args[0], args: args[1], cb: args[2]}
    },

    performSelector: function() {
      var slf = this
      var args = Array.prototype.slice.call(arguments)
      return _methodFunc(slf.__obj, slf.__clsName, args[0], args.splice(1), slf.__isSuper, true)
    }
  }

  for (var method in _customMethods) {//遍历字典对象key为method
    if (_customMethods.hasOwnProperty(method)) {
      Object.defineProperty(Object.prototype, method, {value: _customMethods[method], configurable:false, enumerable: false})//为所有对象都添加__c、super、performSelectorInOC、performSelector方法
    }
  }

  /*
   global全局字典，key为clsName，value为字典，字典中含有 __clsName: clsName
   */
  var _require = function(clsName) {
    if (!global[clsName]) {
      global[clsName] = {
        __clsName: clsName
      }
    } 
    return global[clsName]
  }

  /*
   全局函数，参数通过arguments获取，里面调用私有函数_require
   */
  global.require = function() {
    var lastRequire
    for (var i = 0; i < arguments.length; i ++) {
      arguments[i].split(',').forEach(function(clsName) {
        lastRequire = _require(clsName.trim())
      })
    }
    return lastRequire
  }

  var _formatDefineMethods = function(methods, newMethods, realClsName) {
  
  /*
   var dic = {c:4, a:2, d:3, b:1}; // 定义一个字典
   
   console.log("输出最初的字典元素: ");
   for(var key in dic){
   console.log("key: " + key + " ,value: " + dic[key]);
   }
   */
    for (var methodName in methods) { /*这里methodName为methods字典的key*/
      if (!(methods[methodName] instanceof Function)) return;
      (function(){
        var originMethod = methods[methodName]
        newMethods[methodName] = [originMethod.length, function() { //originMethod.length表示函数期望的参数数量.
          try {
            /*
             
             The slice() method returns a shallow copy of a portion of an array into a new array object selected
             from begin to end (end not included) where begin and end represent the index of items in that array.
             The original array will not be modified.
             
             arr.slice([begin[, end]])
             
             
             function test(a,b,c,d) {
             var arg = Array.prototype.slice.call(arguments,1);
             console.log(arg);
             }
             test("a","b","c","d"); //b,c,d
             */
            /*
             
             slice method can also be called to convert Array-like objects / collections to a new Array.
             You just bind the method to the object. The arguments inside a function is an example of an 'array-like object'.
             
             
             function list() {
             return Array.prototype.slice.call(arguments)
             }
             
             let list1 = list(1, 2, 3) // [1, 2, 3]
             
             
             The splice() method changes the contents of an array by removing or replacing existing elements and/or adding new elements in place.
             
             let arrDeletedItems = array.splice(start[, deleteCount[, item1[, item2[, ...]]]])

             item1[, item2 ] The elements to add to the array, beginning from start
             
             */
            var args = _formatOCToJS(Array.prototype.slice.call(arguments))//arguments is an Array-like object accessible inside functions that contains the values of the arguments passed to that function.
            var lastSelf = global.self
            global.self = args[0]
            if (global.self) global.self.__realClsName = realClsName
            args.splice(0,1),//删除第一个参数global.self
            var ret = originMethod.apply(originMethod, args)
            global.self = lastSelf//还原global.self
            return ret
          } catch(e) {
            _OC_catch(e.message, e.stack)
          }
        }]/*newMethods[methodName]定义为数组，数组第一个元素为函数参数个数，第二个位*/
      })()
    }
  }

  var _wrapLocalMethod = function(methodName, func, realClsName) {//主要是将上下文的__realClsName赋值为realClsName
    return function() {
      var lastSelf = global.self
      global.self = this//global.self保存当前正在执行的this，当func执行完以后，需要恢复到调用之前的this，func.apply(this, arguments)就是执行func
      this.__realClsName = realClsName
      var ret = func.apply(this, arguments)
      global.self = lastSelf
      return ret
    }
  }

  var _setupJSMethod = function(className, methods, isInst, realClsName) {//负责将js定义的method存入全局变量_ocCls字典中
    for (var name in methods) {
      var key = isInst ? 'instMethods': 'clsMethods',
          func = methods[name]
      _ocCls[className][key][name] = _wrapLocalMethod(name, func, realClsName)
    }
  }

  var _propertiesGetFun = function(name){
    return function(){
      var slf = this;
      if (!slf.__ocProps) {
        var props = _OC_getCustomProps(slf.__obj)
        if (!props) {
          props = {}
          _OC_setCustomProps(slf.__obj, props)
        }
        slf.__ocProps = props;
      }
      return slf.__ocProps[name];
    };
  }

  var _propertiesSetFun = function(name){
    return function(jval){
      var slf = this;
      if (!slf.__ocProps) {
        var props = _OC_getCustomProps(slf.__obj)
        if (!props) {
          props = {}
          _OC_setCustomProps(slf.__obj, props)
        }
        slf.__ocProps = props;
      }
      slf.__ocProps[name] = jval;
    };
  }

  /*
   defineClass('JPTestProtocolObject : NSObject <JPTestProtocol, JPTestProtocol2>', ['prop1', 'prop2'], {
   init: function(){
   self = self.super().init();
   self.setProp1('1');
   self.setProp2('2');
   return self;
   },
   _privateMethod: function() {
   return 'P';
   },
   method: function() {
   return 'A' + self.prop1() + self.prop2();
   },
   }, {
   clsMethod: function() {
   return 'A'
   },
   })
   */
  
  global.defineClass = function(declaration, properties, instMethods, clsMethods) {
    var newInstMethods = {}, newClsMethods = {}
    if (!(properties instanceof Array)) { /*如果properties不是定义为数组的话，那么properties就是instMethods，instMethods就是clsMethods*/
      clsMethods = instMethods
      instMethods = properties
      properties = null
    }

    if (properties) {/*表示确实有属性需要处理*/
      properties.forEach(function(name){
        if (!instMethods[name]) {
          instMethods[name] = _propertiesGetFun(name);
        }
        var nameOfSet = "set"+ name.substr(0,1).toUpperCase() + name.substr(1);
        if (!instMethods[nameOfSet]) {
          instMethods[nameOfSet] = _propertiesSetFun(name);
        }
      });
    }

    var realClsName = declaration.split(':')[0].trim()//获取类名，'JPTestProtocolObject : NSObject <JPTestProtocol, JPTestProtocol2>'

    _formatDefineMethods(instMethods, newInstMethods, realClsName)
    _formatDefineMethods(clsMethods, newClsMethods, realClsName)

    var ret = _OC_defineClass(declaration, newInstMethods, newClsMethods)
    var className = ret['cls']
    var superCls = ret['superCls']

    _ocCls[className] = {
      instMethods: {},
      clsMethods: {},
    }

    if (superCls.length && _ocCls[superCls]) {//将父类的所有的实例和类方法赋值给子类
      for (var funcName in _ocCls[superCls]['instMethods']) {
        _ocCls[className]['instMethods'][funcName] = _ocCls[superCls]['instMethods'][funcName]
      }
      for (var funcName in _ocCls[superCls]['clsMethods']) {
        _ocCls[className]['clsMethods'][funcName] = _ocCls[superCls]['clsMethods'][funcName]
      }
    }

    _setupJSMethod(className, instMethods, 1, realClsName)
    _setupJSMethod(className, clsMethods, 0, realClsName)

    return require(className)
  }

  global.defineProtocol = function(declaration, instProtos , clsProtos) {
      var ret = _OC_defineProtocol(declaration, instProtos,clsProtos);
      return ret
  }

  global.block = function(args, cb) {
    var that = this
    var slf = global.self
    if (args instanceof Function) {
      cb = args
      args = ''
    }
    var callback = function() {
      var args = Array.prototype.slice.call(arguments)
      global.self = slf
      return cb.apply(that, _formatOCToJS(args))
    }
    var ret = {args: args, cb: callback, argCount: cb.length, __isBlock: 1}
    if (global.__genBlock) {
      ret['blockObj'] = global.__genBlock(args, cb)
    }
    return ret
  }
  
  if (global.console) {
    var jsLogger = console.log;
    global.console.log = function() {
      global._OC_log.apply(global, arguments);
      if (jsLogger) {
        jsLogger.apply(global.console, arguments);
      }
    }
  } else {
    global.console = {
      log: global._OC_log
    }
  }

  global.defineJSClass = function(declaration, instMethods, clsMethods) {
    var o = function() {},
        a = declaration.split(':'),
        clsName = a[0].trim(),
        superClsName = a[1] ? a[1].trim() : null
    o.prototype = {
      init: function() {
        if (this.super()) this.super().init()
        return this;
      },
      super: function() {
        return superClsName ? _jsCls[superClsName].prototype : null
      }
    }
    var cls = {
      alloc: function() {
        return new o;
      }
    }
    for (var methodName in instMethods) {
      o.prototype[methodName] = instMethods[methodName];
    }
    for (var methodName in clsMethods) {
      cls[methodName] = clsMethods[methodName];
    }
    global[clsName] = cls
    _jsCls[clsName] = o
  }
  
  global.YES = 1
  global.NO = 0
  global.nsnull = _OC_null
  global._formatOCToJS = _formatOCToJS
  
})()
