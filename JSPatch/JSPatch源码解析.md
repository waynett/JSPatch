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

   

6. 下面分析具体执行热更新逻辑，以覆盖OC原始实现为例，入口是调用OC中的方法：

   ```objc
   - (void)handleBtn:(id)sender
   {
   }
   ```

   ```javascript
   require("UIAlertView");
   
   defineClass('JPViewController', {
     
     handleBtn: function(sender) {
          
       var alert = UIAlertView.alloc().initWithTitle_message_delegate_cancelButtonTitle_otherButtonTitles("JSPatchAmend", "Success", null, "Yes", null, null);
       alert.show();
   
     }
   })
   ```

   

   1. 因为handleBtn:(id)sender已经被js重写，handleBtn在js：defineClass => OC:defineClass => OC:override 被直接转发到JPForwardInvocation，而JPForwardInvocation是替换的forwardInvocation，该方法定义如下：

      ```objc
      
        - (void)forwardInvocation:(NSInvocation *)anInvocation;
           
        //forwardInvocation的参数为NSInvocation，所以forwardInvocation的函数签名为"v@:@"
             
      ```


      而NSInvocation对象包含了OC中方法的所有信息，包括：参数个数，方法签名，方法名等，所以在JPForwardInvocation中可以通过NSInvocation取到方法信息：

      ```objc
          NSMethodSignature *methodSignature = [invocation methodSignature];
          NSInteger numberOfArguments = [methodSignature numberOfArguments];
          NSString *selectorName = isBlock ? @"" : NSStringFromSelector(invocation.selector);
          NSString *JPSelectorName = [NSString stringWithFormat:@"_JP%@", selectorName];
      ```

      

   2. JPForwardInvocation通过getJSFunctionInObjectHierachy获取到JavaScript中的function

      ```objc
      static void JPForwardInvocation(__unsafe_unretained id assignSlf, SEL selector, NSInvocation *invocation)
      {
          JSValue *jsFunc = isBlock ? objc_getAssociatedObject(assignSlf, "_JSValue")[@"cb"] : getJSFunctionInObjectHierachy(slf, JPSelectorName);
           
          //一些列封装OC原始方法的参数到params，这个参数列表是作为jsFunc的参数。其中第一个是self本身
          
          NSMutableArray *argList = [[NSMutableArray alloc] init];
          [argList addObject:[JPBoxing boxWeakObj:slf]];
          
          //... 通过方法签名获取每一个参数类型，并添加到argList
      
          NSArray *params = _formatOCToJSList(argList);//将所有oc参数转为js参数
      
          //根据返回值类型，执行响应的代码块，
          
          switch (returnType[0] == 'r' ? returnType[1] : returnType[0]) {
              
      						case '@' : { //如果返回值是对象 
                      JSValue *jsval;
                  		[_JSMethodForwardCallLock lock]; 
                  		jsval = [jsFunc callWithArguments:params];
                  		[_JSMethodForwardCallLock unlock];
                      id __autoreleasing ret = formatJSToOC(jsval);
                      if (ret == _nilObj ||  ([ret isKindOfClass:[NSNumber class]] && strcmp([ret objCType], "c") == 0 && ![ret boolValue])) 
                      {
                        ret = nil;
                      }
                      [invocation setReturnValue:&ret];
                      break;  
                  }
      
          }
      
      ```

      ```objc
      //根据Class和JPSelectorName从_JSOverideMethods全局字典中获取jspatch.js中定义方法名对应的function方法体
      static JSValue *getJSFunctionInObjectHierachy(id slf, NSString *selectorName)
      {
          Class cls = object_getClass(slf);
          if (_currInvokeSuperClsName[selectorName]) {
              cls = NSClassFromString(_currInvokeSuperClsName[selectorName]);
              selectorName = [selectorName stringByReplacingOccurrencesOfString:@"_JPSUPER_" withString:@"_JP"];
          }
          JSValue *func = _JSOverideMethods[cls][selectorName];//_JSOverideMethods在defineClass中已经初始化
          while (!func) {//如果func为空，递归从父类中获取
              cls = class_getSuperclass(cls);
              if (!cls) {//所有类都没有该方法，直接退出返回nil
                  return nil;
              }
              func = _JSOverideMethods[cls][selectorName];
          }
          return func;
      }
      ```

      

   3. JavaScript中的handleBtn会被转换为如下，实际执行的JavaScript函数是下面第二个参数——function()匿名函数：

      ```javascript
      newMethods[methodName] = [originMethod.length, function() { //originMethod.length表示函数期望的参数数量.
                try {             
                  //JPForwardInvocation中封装JS传递过去的
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
              }]
      ```

   4. var ret = originMethod.apply(originMethod, args) 会开始执行JavaScript形式的热更新function：

      ```javascript
      var alert = UIAlertView.alloc().initWithTitle_message_delegate_cancelButtonTitle_otherButtonTitles("JSPatchAmend", "Success", null, "Yes", null, null);
      alert.show();
      ```

      该代码被被格式化为：

       UIAlertView.\__c("alloc")().\__c("initWithTitle_message_delegate_cancelButtonTitle_otherButtonTitles"**)**("JSPatchAmend", "Success", **null**, "Yes", **null**, **null**);

      通过require，UIAlertView被解析成(*<u>UIAlertView在JavaScript是Object</u>*)：

         {
            __clsName:"UIAlertView",
         }

   5. 又因为JSPatch.js执行后，会对所有的Object添加_，如下：

      ```javascript
      var _customMethods = { //_customMethods是字典对象，存 __c: function,super: function,performSelectorInOC: function,performSelector: function
          __c: function(methodName) {//__c类似于构建了js的全局转发函数，因为在oc里面会把所有的js函数用__c包含住,_c函数返回值为_methodFunc返回值，即执行callSelector返回值
             
            //最初this为require方法返回的对象，即：{__clsName:"UIAlertView"},该对象调用__c("alloc")方法,
        
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
            if (clsName && _ocCls[clsName]) {//如果是defineClass中热更新定义的类，直接从_ocCls获取函数实现
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
      
        }
      
        //这里是整个大function的执行地方，其他的var只是定义变量。
        for (var method in _customMethods) {//遍历字典对象key为method
          if (_customMethods.hasOwnProperty(method)) {//Object的hasOwnProperty()方法返回一个布尔值，判断对象是否包含特定的自身（非继承）属性。
            Object.defineProperty(Object.prototype, method,
                                  {
                                  value: _customMethods[method],
                                  configurable:false,//不可更改
                                  enumerable: false
                                  }
          )//为所有对象都添加__c、super、performSelectorInOC、performSelector方法,这样就可以执行function里面的带有__c的语句了
          }
        }
      ```

      所以UIAlertView现在可以解析为：

      ```javascript
      {
            __clsName:"UIAlertView",
            __C:function(methodName){},
            super:function(){}
            ...
      }
      ```

       所以也才可以直接指向UIAlertView.__c("alloc")

   6. __c("alloc")会调用如下匿名函数,如果执行链上的Object没有\__objc属性，表示该Object是类对象，否则就是实例对象（根据_methodFunc的第一个参数slf.\__obj进行判断）：

      ```javascript
      return function(){//__c function返回值又是一个匿名函数-闭包，闭包里面访问外包的_methodFunc方法
              var args = Array.prototype.slice.call(arguments)     
              return _methodFunc(slf.__obj, slf.__clsName, methodName, args, slf.__isSuper)
            }
      
        //initWithTitle_message_delegate_cancelButtonTitle_otherButtonTitles
        //initWithTitle:message:delegate:cancelButtonTitle:otherButtonTitles:;
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
                               _OC_callC(clsName, selectorName, args)//_OC_callC会返回对象：@{@"__obj": obj, @"__clsName":__clsName};
          
          /*
           //返回值字典同时包含对象和对象的类型：@{@"__obj": obj, @"__clsName":__clsName};
           static NSDictionary *_wrapObj(id obj)
           {
               if (!obj || obj == _nilObj) {
                   return @{@"__isNil": @(YES)};
               }
               return @{@"__obj": obj, @"__clsName": NSStringFromClass([obj isKindOfClass:[JPBoxing class]] ? [[((JPBoxing *)obj) unbox] class]: [obj class])};//如果之前已经box封包，解包获取类型，否则直接通过[obj class]
           }
           */
          return _formatOCToJS(ret)
        }
      
      ```

      ![](https://cdn.jsdelivr.net/gh/waynett/imgHosting/imgJietu20200527-173610-HD.gif)

   7. 类对象执行_OC_callC => callSelector

   ```objective-c
   static id callSelector(NSString *className, NSString *selectorName, JSValue *arguments, JSValue *instance, BOOL isSuper)
   {
      
       id argumentsObj = formatJSToOC(arguments);//js端传过来的参数转换为OC数组
       
       Class cls = instance ? [instance class] : NSClassFromString(className);
       SEL selector = NSSelectorFromString(selectorName);
       
       
       NSInvocation *invocation;
       NSMethodSignature *methodSignature;
       if (!_JSMethodSignatureCache) {
           _JSMethodSignatureCache = [[NSMutableDictionary alloc]init];
       }
       if (instance) {//如果是实例方法调用
           [_JSMethodSignatureLock lock];
           if (!_JSMethodSignatureCache[cls]) {
               _JSMethodSignatureCache[(id<NSCopying>)cls] = [[NSMutableDictionary alloc]init];
           }
           methodSignature = _JSMethodSignatureCache[cls][selectorName];//从缓存中获取实例方法
           if (!methodSignature) {//如果缓存没有命中
               methodSignature = [cls instanceMethodSignatureForSelector:selector];//通过cls和selector获取实例方法的签名
               methodSignature = fixSignature(methodSignature);
               _JSMethodSignatureCache[cls][selectorName] = methodSignature;//入缓存
           }
           [_JSMethodSignatureLock unlock];
           if (!methodSignature) {
               _exceptionBlock([NSString stringWithFormat:@"unrecognized selector %@ for instance %@", selectorName, instance]);
               return nil;
           }
           invocation = [NSInvocation invocationWithMethodSignature:methodSignature];//通过方法签名生成NSInvocation对象
           [invocation setTarget:instance];//设置NSInvocation对象的target对象
       } else {
           methodSignature = [cls methodSignatureForSelector:selector];
           methodSignature = fixSignature(methodSignature);
           if (!methodSignature) {
               _exceptionBlock([NSString stringWithFormat:@"unrecognized selector %@ for class %@", selectorName, className]);
               return nil;
           }
           invocation= [NSInvocation invocationWithMethodSignature:methodSignature];
           [invocation setTarget:cls];
       }
       [invocation setSelector:selector];//设置NSInvocation对象的selector对象
       
       /*
        There are always at least two arguments, because an NSMethodSignature object includes the implicit arguments self and _cmd, which are the first two arguments passed to every method implementation.
        */
       NSUInteger numberOfArguments = methodSignature.numberOfArguments;
       NSInteger inputArguments = [(NSArray *)argumentsObj count];
       //[[UIActionSheet alloc] initWithTitle:nil delegate:self cancelButtonTitle:@"取消" destructiveButtonTitle:nil otherButtonTitles:@"拍照",@"从相册选择", nil]
       //- (instancetype)initWithTitle:(nullable NSString *)title delegate:(nullable id<UIActionSheetDelegate>)delegate cancelButtonTitle:(nullable NSString *)cancelButtonTitle destructiveButtonTitle:(nullable NSString *)destructiveButtonTitle otherButtonTitles:(nullable NSString *)otherButtonTitles, ...
       //上面这种最后一个是可变参数的方法，需要特殊处理，上面的inputArguments > numberOfArguments - 2
       if (inputArguments > numberOfArguments - 2) {
           // calling variable argument method, only support parameter type `id` and return type `id`
           id sender = instance != nil ? instance : cls;
           id result = invokeVariableParameterMethod(argumentsObj, methodSignature, sender, selector);
           return formatOCToJS(result);
       }
       
       //调用setArgument将js传递过来的参数设置到NSInvocation的参数，
       for (NSUInteger i = 2; i < numberOfArguments; i++) {
           const char *argumentType = [methodSignature getArgumentTypeAtIndex:i];
           id valObj = argumentsObj[i-2];
           switch (argumentType[0] == 'r' ? argumentType[1] : argumentType[0]) {
                   
                //根据参数类型获取参数值
                case 'c': {                              
                       char value = [valObj charValue];                     
                       [invocation setArgument:&value atIndex:i];
                       break; 
                   }
                                   
               case ':': {
                   SEL value = nil;
                   if (valObj != _nilObj) {
                       value = NSSelectorFromString(valObj);
                   }
                   [invocation setArgument:&value atIndex:i];
                   break;
               }
               case '*':
               case '^': {
                   if ([valObj isKindOfClass:[JPBoxing class]]) {
                       void *value = [((JPBoxing *)valObj) unboxPointer];
                       [invocation setArgument:&value atIndex:i];
                       break;
                   }
               }
               case '#': {
                   if ([valObj isKindOfClass:[JPBoxing class]]) {
                       Class value = [((JPBoxing *)valObj) unboxClass];
                       [invocation setArgument:&value atIndex:i];
                       break;
                   }
               }
          
           }
       }
       
       [invocation invoke];//执行NSInvocation
       
       char returnType[255];
       strcpy(returnType, [methodSignature methodReturnType]);
       
       //对调用返回值进行处理
       id returnValue;
       if (strncmp(returnType, "v", 1) != 0) {//如果NSInvocation调用有返回值
           if (strncmp(returnType, "@", 1) == 0) {//返回值是对象类型
               void *result;
               [invocation getReturnValue:&result];
               
               //For performance, ignore the other methods prefix with alloc/new/copy/mutableCopy
               if ([selectorName isEqualToString:@"alloc"] || [selectorName isEqualToString:@"new"] ||
                   [selectorName isEqualToString:@"copy"] || [selectorName isEqualToString:@"mutableCopy"]) {
                   returnValue = (__bridge_transfer id)result;
               } else {
                   returnValue = (__bridge id)result;
               }
               return formatOCToJS(returnValue);
               
           } else {//返回值是普通Assign数据类型
               switch (returnType[0] == 'r' ? returnType[1] : returnType[0]) {
                       
                   #define JP_CALL_RET_CASE(_typeString, _type) \
                   case _typeString: {                              \
                       _type tempResultSet; \
                       [invocation getReturnValue:&tempResultSet];\
                       returnValue = @(tempResultSet); \
                       break; \
                   }
                       
                   JP_CALL_RET_CASE('c', char)
                   JP_CALL_RET_CASE('C', unsigned char)
                   JP_CALL_RET_CASE('s', short)
                   JP_CALL_RET_CASE('S', unsigned short)
                   JP_CALL_RET_CASE('i', int)
                   JP_CALL_RET_CASE('I', unsigned int)
                   JP_CALL_RET_CASE('l', long)
                   JP_CALL_RET_CASE('L', unsigned long)
                   JP_CALL_RET_CASE('q', long long)
                   JP_CALL_RET_CASE('Q', unsigned long long)
                   JP_CALL_RET_CASE('f', float)
                   JP_CALL_RET_CASE('d', double)
                   JP_CALL_RET_CASE('B', BOOL)
   
                   case '{': {
                       NSString *typeString = extractStructName([NSString stringWithUTF8String:returnType]);
                       #define JP_CALL_RET_STRUCT(_type, _methodName) \
                       if ([typeString rangeOfString:@#_type].location != NSNotFound) {    \
                           _type result;   \
                           [invocation getReturnValue:&result];    \
                           return [JSValue _methodName:result inContext:_context];    \
                       }
                       JP_CALL_RET_STRUCT(CGRect, valueWithRect)
                       JP_CALL_RET_STRUCT(CGPoint, valueWithPoint)
                       JP_CALL_RET_STRUCT(CGSize, valueWithSize)
                       JP_CALL_RET_STRUCT(NSRange, valueWithRange)
                       @synchronized (_context) {
                           NSDictionary *structDefine = _registeredStruct[typeString];
                           if (structDefine) {
                               size_t size = sizeOfStructTypes(structDefine[@"types"]);
                               void *ret = malloc(size);
                               [invocation getReturnValue:ret];
                               NSDictionary *dict = getDictOfStruct(ret, structDefine);
                               free(ret);
                               return dict;
                           }
                       }
                       break;
                   }
                       
                   case '*':
                   case '^': {//如果返回值是指针类型，需要JPBoxing化
                       void *result;
                       [invocation getReturnValue:&result];
                       returnValue = formatOCToJS([JPBoxing boxPointer:result]);
                       if (strncmp(returnType, "^{CG", 4) == 0) {
                           if (!_pointersToRelease) {
                               _pointersToRelease = [[NSMutableArray alloc] init];
                           }
                           [_pointersToRelease addObject:[NSValue valueWithPointer:result]];
                           CFRetain(result);
                       }
                       break;
                   }
                   case '#': {//如果返回值是Class类型
                       Class result;
                       [invocation getReturnValue:&result];
                       returnValue = formatOCToJS([JPBoxing boxClass:result]);
                       break;
                   }
               }
               return returnValue;
           }
       }
       return nil;
   }
   ```

   












