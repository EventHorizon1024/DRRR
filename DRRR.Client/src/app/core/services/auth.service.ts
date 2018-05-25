import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';

import { Observer ,  Observable } from 'rxjs';

import swal from 'sweetalert2';

import { Payload } from '../models/payload.model';
import { Roles } from '../models/roles.enum';
import { SystemMessagesService } from './system-messages.service';

@Injectable()
export class AuthService {

  /**
   * 需要权限验证的Http请求
   */
  http: HttpClient;

  constructor(
    private httpWithoutAuth: HttpClient,
    private msg: SystemMessagesService,
    private router: Router
  ) {
    this.http = this.createWrappedHttpClient();
  }

  /**
   * 表示是否已经登录
   */
  get isLoggedIn(): boolean {
    const payload = this.getPayloadFromToken('access_token');
    // 游客不算登录
    return payload && payload.role >= Roles.user;
  }

  /**
   * 表示是否记住登录状态
   */
  get rememberLoginState(): boolean {
    return localStorage.getItem('remember_me') === 'true';
  }

  /**
   * 表示是否记住登录状态
   * @param {boolean} rememberMe 是否记住登录状态
   */
  set rememberLoginState(rememberMe: boolean) {
    // 为了防止刷新后数据出现问题，将是否记住登录状态的信息保存在localStorage中
    localStorage.setItem('remember_me', rememberMe + '');
  }

  /**
   * 访问令牌
   */
  get accessToken() {
    return this.storage.getItem('access_token');
  }

  /**
   * 将访问令牌保存到客户端
   * @param {string} accessToken 访问令牌
   */
  saveAccessToken(accessToken: string) {
    this.storage.setItem('access_token', accessToken);
  }

  /**
   * 将更新令牌保存到客户端
   * @param {string} refreshToken 更新令牌
   */
  saveRefreshToken(refreshToken: string) {
    this.storage.setItem('refresh_token', refreshToken);
  }

  /**
   * 从Token中获取信息
   * @param {"access_token" | "refresh_token"} tokenName 令牌名称
   * @return {Payload} Token信息
   */
  getPayloadFromToken(tokenName: 'access_token' | 'refresh_token'): Payload {
    let payload: Payload;
    const token = this.storage.getItem(tokenName);

    if (token) {
      payload = JSON.parse(atob(token.split('.')[1])) as Payload;
      // 用atob解码含中文的信息会导致异常，所以在后台对用户名进行了url编码
      payload.unique_name = decodeURI(payload.unique_name);
      // 角色ID为数字
      if (payload.role) {
        payload.role = +payload.role;
      }
    }
    return payload;
  }

  /**
   * 刷新令牌
   * @return {Promise<never>} 刷新令牌任务的Promise对象
   */
  refreshToken(): Promise<never> {
    return new Promise(resolve => {
      this.httpWithoutAuth.post('api/user/refresh-token',
        null,
        { headers: this.getAuthorizationHeader('refresh_token') })
        .subscribe(res => {
          // 重新保存访问令牌
          this.saveAccessToken(res['accessToken']);

          // 执行回调函数
          resolve();
        }, (err: HttpErrorResponse) => {
          if (err.error instanceof Error) {
            // 如果是客户端异常
            console.log('An error occurred:', err.error.message);
          } else {
            // 如果请求发生异常
            console.log(`Backend returned code ${err.status}, body was: ${err.error}`);

            if (err.status === 401) {
              // 如果token验证失效，则回到登录界面
              swal(this.msg.getMessage('E006', '账号信息'),
                this.msg.getMessage('E007', '登录'), 'error')
                .then(() => {
                  // 返回登录界面
                  // 清空localStorage以避免问题发生
                  this.clearTokens();
                  this.router.navigateByUrl('/login');
                });
            }
          }
        });
    });
  }

  /**
   * 当令牌即将过期时先刷新令牌，否则直接执行回调函数
   * @return {Promise<never>} 有需要时刷新令的牌任务的Promise对象
   */
  refreshTokenIfNeeded(): Promise<never> {
    return new Promise((resolve, reject) => {
      const payload = this.getPayloadFromToken('access_token');

      if (payload) {
        // 如果剩余有效时间小于10分钟，则刷新访问令牌
        if ((payload.exp - Math.floor(Date.now() / 1000)) < 600) {
          this.refreshToken().then(resolve);
        } else {
          resolve();
        }
      } else {
        swal(this.msg.getMessage('E004', '账号信息获取'),
          this.msg.getMessage('E007', '登录'), 'error')
          .then(() => {
            // 返回登录界面
            this.router.navigateByUrl('/login');
            reject();
          });
      }
    });
  }

  /**
   * 清除Storage中存放的所有Token信息
   */
  clearTokens() {
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('access_token');
    sessionStorage.removeItem('refresh_token');
    sessionStorage.removeItem('access_token');
  }

  /**
   * 获取存放Token的容器
   * @return {Storage} 存放Token的容器
   */
  private get storage(): Storage {
    return this.rememberLoginState ? localStorage : sessionStorage;
  }

  /**
   * 获得带有权限验证的请求头
   * @param {"access_token" | "refresh_token"} tokenName 令牌名称
   * @return {HttpHeaders} 带有权限验证的请求头
   */
  private getAuthorizationHeader(tokenName: 'access_token' | 'refresh_token'): HttpHeaders {
    return new HttpHeaders()
      .set('Authorization', `Bearer ${this.storage.getItem(tokenName)}`);
  }

  /**
   * 创建包装过的HttpClient对象
   * @return {HttpClient} 包装过的HttpClient对象
   */
  private createWrappedHttpClient(): HttpClient {
    const get: (target: HttpClient, p: PropertyKey) => (...args: any[]) => Observable<any>
      = (target, propKey) => {
        // 被调用的对应的Http方法
        const httpFunc: Function = target[propKey];

        return (...args: any[]): Observable<any> => {
          // 对传入的参数进行编辑
          const getArgs = (): any[] => {
            const headers = this.getAuthorizationHeader('access_token');

            // 如果最后一个参数即options被传入，则进行合并
            if (httpFunc.length === args.length) {
              args[args.length - 1] = { headers, ...args[args.length - 1] };
            } else {
              args.push({ headers });
            }

            // 如果是get方法，为避免ie对get请求存在缓存的问题
            if (propKey === 'get') {
              args[0] += `${/\?[a-z]+=.*$/.test(args[0]) ? '&' : '?'}t=${Date.now()}`;
            }
            return args;
          };

          return Observable.create((observer: Observer<object>) => {
            this.refreshTokenIfNeeded()
              .then(() => {
                httpFunc.apply(target, getArgs())
                  .subscribe(result => observer.next(result), error => observer.error(error));
              }).catch(error => observer.error(error));
          });
        };
      };

    // 支持Proxy则直接返回Proxy对象
    if (typeof Proxy !== 'undefined') {
      return new Proxy(this.httpWithoutAuth, { get });
    } else {
      const wrappedHttpClient: HttpClient = Object.create(this.httpWithoutAuth);
      for (const [propKey, prop] of Object.entries(Object.getPrototypeOf(this.httpWithoutAuth))) {
        if (!(prop instanceof Function)) {
          continue;
        }

        wrappedHttpClient[propKey] = get(this.httpWithoutAuth, propKey);
      }
      return wrappedHttpClient;
    }
  }
}
