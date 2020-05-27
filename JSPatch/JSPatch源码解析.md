#JSPatch源码解析

1.分析入口：[JSPatch startEngine]
```objective-c
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions {
    
    [JPEngine startEngine];
    
    NSString *sourcePath = [[NSBundle mainBundle] pathForResource:@"demo" ofType:@"js"];
    NSString *script = [NSString stringWithContentsOfFile:sourcePath encoding:NSUTF8StringEncoding error:nil];
    [JPEngine evaluateScript:script];
    
    return YES;
}
```
2.startEngine会往context注册一些列的JS调用原生OC端的接口
```objective-c
/*
 startEngine会往context注册一些列的JS调用原生OC端的接口:JS=>OC
 */
+ (void)startEngine
{
    
    if (![JSContext class] || _context) {//[JSContext class]判断当前iOS版本是否支持JavaScriptCore,_context表示已经之前初始化了engine
        return;
    }
    
    JSContext *context = [[JSContext alloc] init];
    
    /*
     context[@""] 会往context注册一些列的JS调用原生OC端的接口，web调试可以看到全局global中已经有了下面的这些javascript函数
     */
    
#ifdef DEBUG
    context[@"po"] = ^JSValue*(JSValue *obj) {
        id ocObject = formatJSToOC(obj);
        return [JSValue valueWithObject:[ocObject description] inContext:_context];
    };

    context[@"bt"] = ^JSValue*() {
        return [JSValue valueWithObject:_JSLastCallStack inContext:_context];
    };
#endif

    //_OC_defineClass热修复中自定义类，可以新增类，也可以override方法或者新增方法
    context[@"_OC_defineClass"] = ^(NSString *classDeclaration, JSValue *instanceMethods, JSValue *classMethods) {
        return defineClass(classDeclaration, instanceMethods, classMethods);
    };

    context[@"_OC_defineProtocol"] = ^(NSString *protocolDeclaration, JSValue *instProtocol, JSValue *clsProtocol) {
        return defineProtocol(protocolDeclaration, instProtocol,clsProtocol);
    };
    
    //_OC_callI js端调用oc端的实例方法
    context[@"_OC_callI"] = ^id(JSValue *obj, NSString *selectorName, JSValue *arguments, BOOL isSuper) {
        return callSelector(nil, selectorName, arguments, obj, isSuper);
    };
    
    //_OC_callI js端调用oc端的类方法
    context[@"_OC_callC"] = ^id(NSString *className, NSString *selectorName, JSValue *arguments) {
        return callSelector(className, selectorName, arguments, nil, NO);
    };
    
    //_OC_formatJSToOC这个方法用于将oc端接收到的js对象转换为oc对象：
    context[@"_OC_formatJSToOC"] = ^id(JSValue *obj) {
        return formatJSToOC(obj);
    };
    
    //_OC_formatOCToJS这个方法用于将oc对象转化为js对象传递给javascript端函数：
    context[@"_OC_formatOCToJS"] = ^id(JSValue *obj) {
        return formatOCToJS([obj toObject]);
    };
    
    context[@"_OC_getCustomProps"] = ^id(JSValue *obj) {
        id realObj = formatJSToOC(obj);
        return objc_getAssociatedObject(realObj, kPropAssociatedObjectKey);
    };
    
    context[@"_OC_setCustomProps"] = ^(JSValue *obj, JSValue *val) {
        id realObj = formatJSToOC(obj);
        objc_setAssociatedObject(realObj, kPropAssociatedObjectKey, val, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    };
    
    //__weak formatJSToOC先将js端传过来的数据转换为OC数据类型，再通过formatOCToJS把数据转化为JS端数据传回去，参数通过[JPBoxing boxWeakObj:obj]进行了weak化
    context[@"__weak"] = ^id(JSValue *jsval) {
        id obj = formatJSToOC(jsval);
        return [[JSContext currentContext][@"_formatOCToJS"] callWithArguments:@[formatOCToJS([JPBoxing boxWeakObj:obj])]];
    };

    context[@"__strong"] = ^id(JSValue *jsval) {
        id obj = formatJSToOC(jsval);
        return [[JSContext currentContext][@"_formatOCToJS"] callWithArguments:@[formatOCToJS(obj)]];
    };
    
    context[@"_OC_superClsName"] = ^(NSString *clsName) {
        Class cls = NSClassFromString(clsName);
        return NSStringFromClass([cls superclass]);
    };
    
    context[@"autoConvertOCType"] = ^(BOOL autoConvert) {
        _autoConvert = autoConvert;
    };

    context[@"convertOCNumberToString"] = ^(BOOL convertOCNumberToString) {
        _convertOCNumberToString = convertOCNumberToString;
    };
    
    context[@"include"] = ^(NSString *filePath) {
        NSString *absolutePath = [_scriptRootDir stringByAppendingPathComponent:filePath];
        if (!_runnedScript) {
            _runnedScript = [[NSMutableSet alloc] init];
        }
        if (absolutePath && ![_runnedScript containsObject:absolutePath]) {
            [JPEngine _evaluateScriptWithPath:absolutePath];
            [_runnedScript addObject:absolutePath];
        }
    };
    
    context[@"resourcePath"] = ^(NSString *filePath) {
        return [_scriptRootDir stringByAppendingPathComponent:filePath];
    };

    context[@"dispatch_after"] = ^(double time, JSValue *func) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(time * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            [func callWithArguments:nil];
        });
    };
    
    context[@"dispatch_async_main"] = ^(JSValue *func) {
        dispatch_async(dispatch_get_main_queue(), ^{
            [func callWithArguments:nil];
        });
    };
    
    context[@"dispatch_sync_main"] = ^(JSValue *func) {
        if ([NSThread currentThread].isMainThread) {
            [func callWithArguments:nil];
        } else {
            dispatch_sync(dispatch_get_main_queue(), ^{
                [func callWithArguments:nil];
            });
        }
    };
    
    context[@"dispatch_async_global_queue"] = ^(JSValue *func) {
        dispatch_async(dispatch_get_global_queue(0, 0), ^{
            [func callWithArguments:nil];
        });
    };
    
    context[@"releaseTmpObj"] = ^void(JSValue *jsVal) {
        if ([[jsVal toObject] isKindOfClass:[NSDictionary class]]) {
            void *pointer =  [(JPBoxing *)([jsVal toObject][@"__obj"]) unboxPointer];
            id obj = *((__unsafe_unretained id *)pointer);
            @synchronized(_TMPMemoryPool) {
                [_TMPMemoryPool removeObjectForKey:[NSNumber numberWithInteger:[(NSObject*)obj hash]]];
            }
        }
    };
    
    context[@"_OC_log"] = ^() {
        NSArray *args = [JSContext currentArguments];
        for (JSValue *jsVal in args) {
            id obj = formatJSToOC(jsVal);
            NSLog(@"JSPatch.log: %@", obj == _nilObj ? nil : (obj == _nullObj ? [NSNull null]: obj));
        }
    };
    
    context[@"_OC_catch"] = ^(JSValue *msg, JSValue *stack) {
        _exceptionBlock([NSString stringWithFormat:@"js exception, \nmsg: %@, \nstack: \n %@", [msg toObject], [stack toObject]]);
    };
    
    context.exceptionHandler = ^(JSContext *con, JSValue *exception) {
        NSLog(@"%@", exception);
        _exceptionBlock([NSString stringWithFormat:@"js exception: %@", exception]);
    };
    
    _nullObj = [[NSObject alloc] init];
    context[@"_OC_null"] = formatOCToJS(_nullObj);
    
    _context = context;
    
    _nilObj = [[NSObject alloc] init];
    _JSMethodSignatureLock = [[NSLock alloc] init];
    _JSMethodForwardCallLock = [[NSRecursiveLock alloc] init];
    _registeredStruct = [[NSMutableDictionary alloc] init];
    _currInvokeSuperClsName = [[NSMutableDictionary alloc] init];
    
#if TARGET_OS_IPHONE
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(handleMemoryWarning) name:UIApplicationDidReceiveMemoryWarningNotification object:nil];
#endif
    
    //执行JSPatch.js初始化整个Javascript环境
    NSString *path = [[NSBundle bundleForClass:[self class]] pathForResource:@"JSPatch" ofType:@"js"];
    if (!path) _exceptionBlock(@"can't find JSPatch.js");
    NSString *jsCore = [[NSString alloc] initWithData:[[NSFileManager defaultManager] contentsAtPath:path] encoding:NSUTF8StringEncoding];
    
    if ([_context respondsToSelector:@selector(evaluateScript:withSourceURL:)]) {
        [_context evaluateScript:jsCore withSourceURL:[NSURL URLWithString:@"JSPatch.js"]];
    } else {
        [_context evaluateScript:jsCore];
    }
}
```
通过Safari调试可以看到这些接口已经注册到了浏览器的Javascript的全局变量中，如下：

![](https://cdn.jsdelivr.net/gh/waynett/imgHosting/img20200522111233.png)

3.加载热更新js文件,并执行evaluateScript.

```objective-c
NSString *sourcePath = [[NSBundle mainBundle] pathForResource:@"demo" ofType:@"js"];
NSString *script = [NSString stringWithContentsOfFile:sourcePath encoding:NSUTF8StringEncoding error:nil];
[JPEngine evaluateScript:script];
  
+ (JSValue *)evaluateScript:(NSString *)script
{
    return [self _evaluateScript:script withSourceURL:[NSURL URLWithString:@"main.js"]];
}

+ (JSValue *)_evaluateScript:(NSString *)script withSourceURL:(NSURL *)resourceURL
{
    if (!script || ![JSContext class]) {
        _exceptionBlock(@"script is nil");
        return nil;
    }
    [self startEngine];
    
    if (!_regex) {
        _regex = [NSRegularExpression regularExpressionWithPattern:_regexStr options:0 error:nil];
    }
    NSString *formatedScript = [NSString stringWithFormat:@";(function(){try{\n%@\n}catch(e){_OC_catch(e.message, e.stack)}})();", [_regex stringByReplacingMatchesInString:script options:0 range:NSMakeRange(0, script.length) withTemplate:_replaceStr]];
    @try {
        if ([_context respondsToSelector:@selector(evaluateScript:withSourceURL:)]) {
            return [_context evaluateScript:formatedScript withSourceURL:resourceURL];
        } else {
            return [_context evaluateScript:formatedScript];
        }
    }
    @catch (NSException *exception) {
        _exceptionBlock([NSString stringWithFormat:@"%@", exception]);
    }
    return nil;
}
```
在里面进行了如下操作：

1. var** alert = UIAlertView.alloc().initWithTitle_message_delegate_cancelButtonTitle_otherButtonTitles("JSPatchAmend", "Success", **null**, "Yes", **null**, **null**);=> 转换为 UIAlertView.\__c("alloc")().\__c("initWithTitle_message_delegate_cancelButtonTitle_otherButtonTitles"**)**("JSPatchAmend", "Success", **null**, "Yes", **null**, **null**);

2. 执行defineClass，

   ```objective-c
     var _ocCls = {};//保存热更新defineClass中方法的实现，_ocCls[clsName][isInstance][funcName] = function () {};
   
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
   
       _formatDefineMethods(instMethods, newInstMethods, realClsName)  //主要是将方法的参数个数获取到，后面传给OC端,OC端可以很方便的获取到JS端到OC端的参数个数
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
   
       _setupJSMethod(className, instMethods, 1, realClsName)//负责将js定义的method存入全局变量_ocCls字典中
       _setupJSMethod(className, clsMethods, 0, realClsName)
   
       return require(className)//执行require，引入类，为JavaScript函数链的执行进行准备工作
     }
   
    //主要是将方法的参数个数获取到，后面传给OC端
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
   
   var _setupJSMethod = function(className, methods, isInst, realClsName) {//负责将js定义的method存入全局变量_ocCls字典中
       for (var name in methods) {
         var key = isInst ? 'instMethods': 'clsMethods',
             func = methods[name]
         _ocCls[className][key][name] = _wrapLocalMethod(name, func, realClsName)
       }
     }
   ```

3. _OC_defineClass  JS调用OC进行热更新方法重写。

   ```objective-c
   //return @{@"cls": className, @"superCls": superClassName}; 返回值为包含类名和父类名的字典
   static NSDictionary *defineClass(NSString *classDeclaration, JSValue *instanceMethods, JSValue *classMethods)
   {
       NSScanner *scanner = [NSScanner scannerWithString:classDeclaration];
       
       NSString *className;
       NSString *superClassName;
       NSString *protocolNames;
       [scanner scanUpToString:@":" intoString:&className];
       if (!scanner.isAtEnd) {
           scanner.scanLocation = scanner.scanLocation + 1;
           [scanner scanUpToString:@"<" intoString:&superClassName];
           if (!scanner.isAtEnd) {
               scanner.scanLocation = scanner.scanLocation + 1;
               [scanner scanUpToString:@">" intoString:&protocolNames];
           }
       }
       
       if (!superClassName) superClassName = @"NSObject";
       className = trim(className);
       superClassName = trim(superClassName);
       
       NSArray *protocols = [protocolNames length] ? [protocolNames componentsSeparatedByString:@","] : nil;
       
       Class cls = NSClassFromString(className);
       if (!cls) { //如果原来没有定义类
           Class superCls = NSClassFromString(superClassName);
           if (!superCls) {//该类的父类也没有
               _exceptionBlock([NSString stringWithFormat:@"can't find the super class %@", superClassName]);
               return @{@"cls": className};
           }
           cls = objc_allocateClassPair(superCls, className.UTF8String, 0);
           objc_registerClassPair(cls);
       }
       
       if (protocols.count > 0) {
           for (NSString* protocolName in protocols) {
               Protocol *protocol = objc_getProtocol([trim(protocolName) cStringUsingEncoding:NSUTF8StringEncoding]);
               class_addProtocol (cls, protocol);
           }
       }
       
       for (int i = 0; i < 2; i ++) {
           BOOL isInstance = i == 0;
           JSValue *jsMethods = isInstance ? instanceMethods: classMethods;
           
           Class currCls = isInstance ? cls: objc_getMetaClass(className.UTF8String);
           NSDictionary *methodDict = [jsMethods toDictionary];
           for (NSString *jsMethodName in methodDict.allKeys) {
               JSValue *jsMethodArr = [jsMethods valueForProperty:jsMethodName];
               int numberOfArg = [jsMethodArr[0] toInt32]; //获取参数的个数，这是为什么要在_formatDefineMethods中把函数的参数个数封装到数组中的原因，这个主要用在后面如果OC中没有定义该方法的时候
               NSString *selectorName = convertJPSelectorString(jsMethodName);
               
               if ([selectorName componentsSeparatedByString:@":"].count - 1 < numberOfArg) {
                   selectorName = [selectorName stringByAppendingString:@":"];
               }
               
               JSValue *jsMethod = jsMethodArr[1];//获取javascript函数
               if (class_respondsToSelector(currCls, NSSelectorFromString(selectorName))) {//OC类已经存在该方法，需要替换override方法
                   overrideMethod(currCls, selectorName, jsMethod, !isInstance, NULL);
               } else {
                   BOOL overrided = NO;
                   for (NSString *protocolName in protocols) {
                       char *types = methodTypesInProtocol(protocolName, selectorName, isInstance, YES);
                       if (!types) types = methodTypesInProtocol(protocolName, selectorName, isInstance, NO);
                       if (types) {
                           overrideMethod(currCls, selectorName, jsMethod, !isInstance, types);
                           free(types);
                           overrided = YES;
                           break;
                       }
                   }
                   if (!overrided) {//如果OC没有定义该实例方法，需要通过numberOfArg参数个数构造method sel类型签名。这里JS传过来的参数都是对象类型（即JS端有特殊处理机制）
                       if (![[jsMethodName substringToIndex:1] isEqualToString:@"_"]) {
                           NSMutableString *typeDescStr = [@"@@:" mutableCopy];
                           for (int i = 0; i < numberOfArg; i ++) {
                               [typeDescStr appendString:@"@"];
                           }
                           overrideMethod(currCls, selectorName, jsMethod, !isInstance, [typeDescStr cStringUsingEncoding:NSUTF8StringEncoding]);
                       }
                   }
               }
           }
       }
       
       class_addMethod(cls, @selector(getProp:), (IMP)getPropIMP, "@@:@");
       class_addMethod(cls, @selector(setProp:forKey:), (IMP)setPropIMP, "v@:@@");
   
       return @{@"cls": className, @"superCls": superClassName};
   }
   ```

4. overrideMethod是核心消息转发实现方案：

   ```objective-c
   static void overrideMethod(Class cls, NSString *selectorName, JSValue *function, BOOL isClassMethod, const char *typeDescription)
   {
       SEL selector = NSSelectorFromString(selectorName);
       
       if (!typeDescription) {//如果为NULL表示对象本来包含该方法，通过class_getInstanceMethod获取method。通过method_getTypeEncoding能得到方法类型签名，如果不为空，外面直接传进来了typeDescription
           Method method = class_getInstanceMethod(cls, selector);
           typeDescription = (char *)method_getTypeEncoding(method);
       }
       
       IMP originalImp = class_respondsToSelector(cls, selector) ? class_getMethodImplementation(cls, selector) : NULL; //获取原始的实现
       
       IMP msgForwardIMP = _objc_msgForward;//_objc_msgForward表示直接走forwardInvocation进行消息转发，不进行其他的消息转发判断与处理
       #if !defined(__arm64__)
           if (typeDescription[0] == '{') {//当返回值是结构体时特殊处理。需要_objc_msgForward_stret进行转发
               //In some cases that returns struct, we should use the '_stret' API:
               //http://sealiesoftware.com/blog/archive/2008/10/30/objc_explain_objc_msgSend_stret.html
               //NSMethodSignature knows the detail but has no API to return, we can only get the info from debugDescription.
               NSMethodSignature *methodSignature = [NSMethodSignature signatureWithObjCTypes:typeDescription];
               if ([methodSignature.debugDescription rangeOfString:@"is special struct return? YES"].location != NSNotFound) {
                   msgForwardIMP = (IMP)_objc_msgForward_stret;
               }
           }
       #endif
   
       /*
        - (void)forwardInvocation:(NSInvocation *)anInvocation;
        
        forwardInvocation的参数为NSInvocation，所以forwardInvocation的函数签名为"v@:@"
        
        */
       if (class_getMethodImplementation(cls, @selector(forwardInvocation:)) != (IMP)JPForwardInvocation) { //如果当前消息转发不是JPForwardInvocation的话，用JPForwardInvocation取代原先的转发
           IMP originalForwardImp = class_replaceMethod(cls, @selector(forwardInvocation:), (IMP)JPForwardInvocation, "v@:@");
           if (originalForwardImp) {
               class_addMethod(cls, @selector(ORIGforwardInvocation:), originalForwardImp, "v@:@");//ORIGforwardInvocation保留原先的forwardInvocation消息转发
           }
       }
   
       [cls jp_fixMethodSignature];
       if (class_respondsToSelector(cls, selector)) {
           NSString *originalSelectorName = [NSString stringWithFormat:@"ORIG%@", selectorName];
           SEL originalSelector = NSSelectorFromString(originalSelectorName);
           if(!class_respondsToSelector(cls, originalSelector)) {//检查之前方法是不是被ORIGhandle替换，如果没有被替换，就进行替换
               class_addMethod(cls, originalSelector, originalImp, typeDescription);
           }
       }
       
       NSString *JPSelectorName = [NSString stringWithFormat:@"_JP%@", selectorName];
       
       _initJPOverideMethods(cls);
       _JSOverideMethods[cls][JPSelectorName] = function; //function函数保存在[类][JP+selectorName]字典中
       
       // Replace the original selector at last, preventing threading issus when
       // the selector get called during the execution of `overrideMethod`
       class_replaceMethod(cls, selector, msgForwardIMP, typeDescription);
   }
   ```

   

5. 执行require，引入类，为JavaScript函数链的执行进行准备工作

   ```objective-c
    /*
      global全局字典，key为clsName，value为字典，字典中含有 __clsName: clsName
      
      require("UIAlertView");
   
      //this.UIAlertView 等同于 global[UIAlertView]，这个理解很重要，不然很难理解UIAlertView._c("alloc")()._c("initWithTitle_message_delegate_cancelButtonTitle_otherButtonTitles")();是怎么开始执行的。
      //实际上UIAlertView会返回字典对象，而对象默认都有__c函数，可以开始JavaScript函数链的执行
      
      this.UIAlertView = {
         __clsName:"UIAlertView",
      }
   
      require返回字典，字典key为clsName类名
      
      即相当于=>
      
      {
         __clsName:"UIAlertView",
      }
      
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
   ```

   

6. 






