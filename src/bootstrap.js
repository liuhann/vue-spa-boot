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
     * @param {object} [bootOpts.vueRoot={}] root vue
     * @param {string} [bootOpts.mount="app"] the html element to mount to
     * @param {boolean} [bootOpts.routeContext=false] generate new ctx on each route
     * @param {object} [bootOpts.servers] http services locations
     * @param {function} [bootOpts.started] trigger on bootstrap complete
     * @param {string} [bootOpts.routeName] 页面加载后默认进入的路由命名
     */
    constructor(bootOpts) {
        this.VueRoot = bootOpts.vueRoot || {};
        this.modules = bootOpts.modules;
        this.mount = bootOpts.mount || '#app';
        this.servers = bootOpts.servers;
		this.startCallback = bootOpts.started || function(vm){ };
        this.routeContext = bootOpts.routeContext || false;
    }

    /**
     * 处理在路由导航时加入上下文对象， 在组件中可以直接用 this.ctx进行调用
     * @param router
     */
    attachRouteContext(router) {

        //这个方法在路由组件进入时被触发 这时vue组件还未加载
        router.beforeEach(async (to, from, next) => {
            next();
        });

        Vue.mixin({
            beforeCreate: function() {

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
		const rootContext = this.getContext();
	    Object.defineProperty(Vue.prototype, 'ctx', {
		    get () { return rootContext }
	    });
        Vue.config.errorHandler = function (err, vm, info) {
            // handle error
            // `info` is a Vue-specific error info, e.g. which lifecycle hook
            // the error was found in. Only available in 2.2.0+
            if (vm.ctx) {
                vm.ctx.onError(err, vm, info);
            }
        }
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
        this.app = new Vue(this.vueRoot).$mount(this.mount);
        // 现在，应用已经启动了！
        await this.started();
    }

    /**
     * 整个app启动完成后的操作。 可以在此处设置， 默认加载的第一页
     */
    async started() {
		await this.startCallback(this.app);
    }
}

export default BootStrap;