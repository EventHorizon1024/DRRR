import { Injectable } from '@angular/core';
import { Router, CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';

import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import swal from 'sweetalert2';

import { AuthService } from '../core/services/auth.service';
import { SystemMessagesService } from '../core/services/system-messages.service';
import { Roles } from '../core/models/roles.enum';

@Injectable()
export class ChatRoomsAuthGuard implements CanActivate {

  constructor(
    private auth: AuthService,
    private msg: SystemMessagesService,
    private router: Router) {
  }

  canActivate(next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot): Observable<boolean> | Promise<boolean> | boolean {
    const payload = this.auth.getPayloadFromToken('access_token');

    if (!payload) {
      // 如果登录信息不存在则返回登录界面
      swal(this.msg.getMessage('E004', '账号信息获取'),
        this.msg.getMessage('E007', '登录'), 'error')
        .then(() => {
          // 返回登录界面
          this.router.navigateByUrl('/login');
        });
      return false;
    }

    // 游客直接让其进入房间列表页面
    if (payload.role === Roles.guest) {
      return true;
    }

    // 判断用户是否处于某个房间中
    return this.auth.http.get('/api/rooms/previous-room-id', { responseType: 'text' })
      .pipe(map(id => {
        if (id) {
          // 如果存在之前房间，则直接跳转到之前的房间
          this.router.navigateByUrl(`/rooms/${id}`);
          return false;
        }
        return true;
      }));
  }
}
