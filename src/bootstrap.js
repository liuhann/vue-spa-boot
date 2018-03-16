import Vue from 'vue';
import VueRouter from 'vue-router';

import HttpClient from './utils/http-client';
import contextProto from  '../utils/context';

import {isFunction, isPlainObject} from './utils/lang';

/**
 * Boot Strap class
 * Load modules, extract vue routes and data services
 * @class BootStrap
 */
class BootStrap {
    /**
     * @param {object} bootOpts boot options
     * @param {array} bootOpts.modules module list
     * @param {object} bootOpts.rootVue root vue
     * @param {string} [bootOpts.mount] the html element to mount to
     * @param {object} [bootOpts.servers] http services locations
     * @param {string} [bootOpts.routePath] 页面加载后默认进入的路由地址
     * @param {string} [bootOpts.routeName] 页面加载后默认进入的路由命名
     * @param {function} [bootOpts.beforeStarted] 启动前执行的操作。
     * @param {boolean} [bootOpts.loginPath] 默认登录页面。
     */
    constructor(bootOpts) {
        this.VueRoot = bootOpts.vueRoot || {};
        this.modules = bootOpts.modules;
        this.mount = bootOpts.mount || '#xbn-app';

        this.servers = bootOpts.servers;
        this.authentication = new Authentication(this);  //验证相关组件，处理token设置、http请求相关控制问题

        //默认进入页路径或者名称 当进入根时访问
        this.routePath = bootOpts.routePath;
        this.routeName = bootOpts.routeName;

        //设置默认登录页面， 当401时需要跳转到此页
        this.loginPath = bootOpts.loginPath || '/login';

        this.checkLogin = bootOpts.checkLogin || function() { return true };
        this.globalContext = null;
    }

    /**
     * 处理在路由导航时加入上下文对象， 在组件中可以直接用 this.ctx进行调用
     * @param router
     */
    attachRouteContext(router) {
        let bootstrap = this;
        let routeContext = null;

        //这个方法在路由组件进入时被触发 这时vue组件还未加载
        router.beforeEach(async (to, from, next) => {
            //当new Vue时， 会立即进入一次 #/的路由地址， 如果配置的话进入毫无意义，这里判断 必须要bootstrap启动后才去继续路由
            if (to.fullPath==='/') {
                next(false);
                return;
            }
            routeContext = this._getContext();          //仅获取一次ctx
            routeContext.params = to.params;

            //1 读取路由对应模块的errors信息， 如果为函数，则执行一次调用， 将函数返回的异常assign到nt.httpErrorCodes之中
            try {
                //这里进行模块的一些延迟初始化操作， 这些操作应该在模块第一次被路由到时执行
                if (to && to.meta && to.meta.module) {
                    if (isFunction(to.meta.module.errors) && !to.meta.module.errorLoaded) {
                        const errors = await to.meta.module.errors(routeContext);
                        nt.httpErrorCodes = Object.assign(nt.httpErrorCodes, errors);
                        to.meta.module.errorLoaded = true;
                    }
                    if (isPlainObject(to.meta.module.errors)) {
                        nt.httpErrorCodes = Object.assign(nt.httpErrorCodes, to.meta.module.errors);
                    }
                }
            } catch (err) {
                //失败不应该影响路由得流程
                console.err('获取模块的默认设置失败', err);
            }
            /*
             if(to.matched && to.matched.length>0) {
             convertVueMethodsToAsync(to.matched);
             }
             */
            next();
        });

        Vue.mixin({
            beforeCreate: function() {
                this.ctx = routeContext;    //将ctx对象写入每个组件
                //写入组件logger
                if (this.$options.__file) {
                    //根据组件文件名称获取logger名
                    this.logger = this.$nt.logger.from(StringUtils.filename(this.$options.__file));
                } else {
                    this.logger = this.$nt.logger;
                }
            }
        });
    }

    /**
     * Making page ctx
     * @returns {contextProto}
     */
    getContext() {
        const ctx = Object.create(contextProto);
        ctx.bootstrap = this;

        //Register ctx.servers.xxx
        if (this.servers) {
            ctx.servers = {};
            for(const key in this.servers) {
                //each server has different config
                ctx.servers[key] = new HttpClient(this.servers[key]);
                if (key === 'default') { //register default to ctx.server
                    ctx.server = ctx.servers[key];
                }
            }
        } else {
            //未进行server配置的话，会默认初始化一个不进行url改写的client
            ctx.server = new HttpClient();
        }
        return ctx;
    }

    /**
     * 统一配置Vue的参数。
     */
    configVue() {
        Vue.config.errorHandler = function (err, vm, info) {
            // handle error
            // `info` is a Vue-specific error info, e.g. which lifecycle hook
            // the error was found in. Only available in 2.2.0+
            if (vm.ctx) {
                vm.ctx.onError(err, vm, info);
            }
        }
    }

    beforeStart(beforestarted) {
        this.beforeStarted = beforestarted;
    }

    /**
     * 实际执行SPA的启动工作。包括以下流程
     *
     * 0. 处理Vue相关内容
     * 1. 加载和解析模块
     * 2. 创建 router 实例，通过ModuleExtractor解析出路由配置，传入vue-router
     * 3. 注册数据模型对象到nt
     * 4. 创建和挂载Vue根实例。
     * 5. started回调
     *
     */
    async startUp() {
        //1. 处理Vue相关内容
        await this.configVue();
        const routes = [];      //模块中定义的路由

        // 依次循环解析每个module
        for(const module of this.modules) {
            //2.初始化模块的路由，统一增加到routers之中
            if (module.routes) {
                //将模块定义信息(module)写入所属的每个路由之中, 将来在路由进入后可以进行统一处理
                module.routes.forEach(function(route) {
                    if (route.meta == null) {
                        route.meta = {};
                    }
                    route.meta.module = module;
                });
                [].push.apply(routes, module.routes);
            }
        }

        //2. 创建 router 实例，
        this.router = new VueRouter({
            routes: this.routes
        });

        //3. 创建和挂载根实例。
        // 记得要通过 router 配置参数注入路由，从而让整个应用都有路由功能
        this.VueRoot.router = this.router;
        this.attachRouteContext(this.router);

        //4. 启动Vue
        this.app = new Vue(this.VueRoot).$mount(this.mount);
        // 现在，应用已经启动了！
        nt.logger.style('boot complete');
        await this.started();
    }


    /**
     * 整个app启动完成后的操作。 可以在此处设置， 默认加载的第一页
     */
    async started() {
        //绑定vue根app到ctx属性
        contextProto.vmapp = this.app;
        contextProto.appCode = this.appCode;

        if (location.hash === '#/') { //访问路由的根
            //ctx.__checkUserLoggedin 属性是在portal默认模块中检查的。 只有定义了并且明确检查过未登录，则跳转到登录页
            if (this._getContext().__checkUserLoggedin === false) {
                this.pageLogin();
            } else {
                this.pageHome();
            }
        }
    }

    /**
     * 来到默认首页
     */
    pageHome() {
        // 5. 按配置路由到特定的路由地址
        if (this.routePath) {
            this.router.replace(this.routePath)
        } else if (this.routeName) {
            this.router.replace({
                name: this.routeName
            });
        }
    }


    /**
     * 跳转到登录页面
     */
    pageLogin() {
        this.router.replace({
            path: this.loginPath
        });
    }
}

export default BootStrap;