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

```
3.


