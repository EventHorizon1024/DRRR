import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import swal from 'sweetalert2';

import * as Cropper from 'cropperjs';

import { Observable, Subject, Subscription } from 'rxjs';
import { fromEvent } from 'rxjs/internal/observable/fromEvent';
import { scan, map } from 'rxjs/operators';

import { ChatRoomService } from './chat-room.service';
import { Message } from '../models/message.model';
import { ChatRoomInitialDisplayDto } from '../dtos/chat-room-initial-display.dto';
import { ChatRoomMemberDto } from '../dtos/chat-room-member.dto';
import { SystemMessagesService } from '../../core/services/system-messages.service';

@Component({
  selector: 'app-chat-room',
  templateUrl: './chat-room.component.html',
  styleUrls: ['./chat-room.component.css']
})
export class ChatRoomComponent implements OnInit, OnDestroy {

  messages: Observable<Message[]>;

  chatHistory: Observable<Message[]>;

  initialDto: Subject<ChatRoomInitialDisplayDto>;

  noMoreMessage: boolean;

  memberList: Subject<ChatRoomMemberDto[]>;

  isMemberListVisible: boolean;

  onlineUsers: Observable<number>;

  lastMessage: Message;

  // 是否让滚动条固定在底部
  fixedAtBottom: boolean;

  isLoadingHistory: boolean;

  private msgSubscription: Subscription;

  private resizeSubscription: Subscription;

  private domNodeInsertedSubscription: Subscription;

  private scrollSubscription: Subscription;

  constructor(
    private chatRoomService: ChatRoomService,
    private route: ActivatedRoute,
    private msg: SystemMessagesService
  ) {
    // 初始化的时候，显示加载的转圈
    this.isLoadingHistory = true;

    // 默认不显示用户列表
    this.isMemberListVisible = false;

    this.fixedAtBottom = true;
  }

  ngOnInit() {
    // 避免谷歌浏览器在显示更多历史记录的时候，产生横向抖动
    $('body').addClass('scroll-hide');

    // 聊天界面窗口高度
    // 一开始的高度
    this.setHeight();

    // 设置滚动条样式
    const scrollPanel$ = $('.msg-container-base');

    setTimeout(() => {
      (<any>scrollPanel$).niceScroll({ cursorcolor: '#d6d6d4' });
    });

    // 重新设置窗口大小后
    this.resizeSubscription = fromEvent(window, 'resize')
      .subscribe(() => {
        this.setHeight();
        (<any>scrollPanel$).getNiceScroll().resize();
        if (this.fixedAtBottom) {
          this.scrollToBottom();
        }
      });

    // 避免查看聊天信息的时候有新消息会导致被迫滚到最下面
    const scrollPanel = scrollPanel$[0];
    this.scrollSubscription
      = fromEvent<Event>(scrollPanel, 'scroll')
        .pipe(
          map(_ => null),
          scan((topAndTopDiff: number[]) => {
            const scrollTop = scrollPanel.scrollTop;
            return [scrollTop, scrollTop - topAndTopDiff[0]];
          }, [0, 0]),
          map(topAndTopDiff => topAndTopDiff[1]))
        .subscribe(diff => {
          if (diff < 0) {
            // 如果用户进行了向上滚的动作
            this.fixedAtBottom = false;
          } else if (scrollPanel.scrollTop + scrollPanel.clientHeight >= scrollPanel.scrollHeight) {
            // 如果滚动到底了
            this.fixedAtBottom = true;
            this.lastMessage = null;
          }
        });

    this.chatRoomService.onReconnect = () => {
      // 重连过程中，隐藏成员列表
      $('.member-list').hide()
        .removeClass('fadeInDown fadeOutUp')
        .addClass('animated fadeOutUp');
      this.isMemberListVisible = false;

      this.messages = this.chatRoomService.message
        .pipe(scan((messages: Message[], message: Message) => {
          // 用于在下方显示最新的未读信息
          this.lastMessage = message;
          return messages.concat(message);
        }, []));

      // 聊天历史记录
      this.chatHistory = this.chatRoomService.chatHistory
        .pipe(scan((messages: Message[], history: Message[]) =>
          history.concat(messages), []));

      this.msgSubscription = this.messages.subscribe(() => {
        if (this.fixedAtBottom) {
          this.lastMessage = null;
          // 消息窗口滚至下方
          this.scrollToBottom();
        }
      });

      this.isLoadingHistory = true;
      this.chatRoomService.getChatHistory()
        .then(count => {
          // 显示用户列表
          $('.member-list').show();
          this.showOrHideMemberList();

          this.noMoreMessage = count < 20;
          this.isLoadingHistory = false;
          this.scrollToBottom();
        });
    };

    const roomId = this.route.snapshot.params['id'];
    this.chatRoomService.connect(roomId);
    this.initialDto = this.chatRoomService.initialDto;
    this.memberList = this.chatRoomService.memberList;
    this.onlineUsers = this.memberList.pipe(map(list => {
      return list.filter(member => member.isOnline).length;
    }));
  }

  ngOnDestroy() {
    this.chatRoomService.onReconnect = null;

    this.msgSubscription.unsubscribe();
    this.resizeSubscription.unsubscribe();
    if (this.domNodeInsertedSubscription) {
      this.domNodeInsertedSubscription.unsubscribe();
    }
    this.scrollSubscription.unsubscribe();
    // 离开房间时关闭连接
    this.chatRoomService.disconnect();

    $('body').removeClass('scroll-hide');
  }

  /**
   * 发送消息
   * @param {HTMLInputElement} message 消息框输入控件
   * @returns {boolean} 返回false避免事件冒泡
   */
  sendMessage(message: HTMLInputElement): boolean {
    this.fixedAtBottom = true;
    this.scrollToBottom();
    if (message.value && message.value.length <= 200) {
      this.chatRoomService.sendMessage(message);
    }
    return false;
  }

  /**
   * 显示更多历史消息
   */
  showMoreChatHistory() {
    if (this.isLoadingHistory) {
      return;
    }
    this.isLoadingHistory = true;
    // 避免增加历史信息时将下方内容顶下去，
    const scrollPanel$ = $('.msg-container-base');
    const scrollPanel = scrollPanel$[0];
    const div = $('.history div:first-child')[0];
    if (this.domNodeInsertedSubscription) {
      this.domNodeInsertedSubscription.unsubscribe();
    }
    this.domNodeInsertedSubscription
      = fromEvent<MutationEvent>(scrollPanel, 'DOMNodeInserted')
        .subscribe(() => {
          div.scrollIntoView();
          scrollPanel.scrollTop -= 65;
        });
    this.chatRoomService.getChatHistory()
      .then(count => {
        this.noMoreMessage = count < 20;
        this.isLoadingHistory = false;
        setTimeout(() => {
          // 避免滚动条错位
          (<any>scrollPanel$).getNiceScroll().resize();
        });
      });
  }

  /**
   * 失去焦点后调节高度（针对移动端）
   */
  onLostFocus() {
    setTimeout(this.setHeight);
  }

  /**
   * 显示或者隐藏成员列表
   */
  showOrHideMemberList() {
    this.isMemberListVisible = !this.isMemberListVisible;
    $('.member-list').toggleClass('fadeInDown fadeOutUp');
  }

  /**
   * 房间成员被要求删除
   * @param {string} uid 用户ID
   */
  onMemberRemoved(uid: string) {
    this.chatRoomService.removeMember(uid);
  }

  /**
   * 发送图片
   * @param {HTMLInputElement} fileInput input的dom对象
   */
  sendPicture(fileInput: HTMLInputElement) {
    this.fixedAtBottom = true;

    let cropper: Cropper;

    let image: HTMLImageElement;

    const file = fileInput.files[0];

    const url = URL.createObjectURL(file);

    // 清空value值,避免两次选中同样的文件时不触发change事件
    fileInput.value = '';

    // 简单判断是不是GIF，后台会进行二次判断
    const isGif = file.type === 'image/gif';

    // 设置图像显示区域的最大高度和最大宽度
    // 当前设备屏幕的一半
    // 不应该用screen.availWidth，在safari上判断会失败
    // 因为在html上设置过width=device-width，所以可以用width=device-width得到准确数据
    const length = Math.min(window.innerWidth - 60, 460);
    swal({
      title: '发送图片',
      html: `
        <div class="img-container">
          <img src="${url}" style="max-height: ${length}px;max-width: ${length}px">
        </div>`,
      showCloseButton: true,
      showCancelButton: true,
      showLoaderOnConfirm: true,
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      allowOutsideClick: false,
      onOpen() {
        if (!isGif) {
          image = $('.img-container img')[0] as HTMLImageElement;
          cropper = new Cropper(image, {
            viewMode: 2,
            dragMode: 'move',
            autoCropArea: 1,
            minContainerWidth: length,
            minContainerHeight: length
          });
        }
      },
      preConfirm: () => {
        return new Promise(resolve => {
          if (isGif) {
            const fileReader = new FileReader();
            fileReader.readAsDataURL(file);
            fileReader.addEventListener('load', () => {
              resolve(fileReader.result);
            });
          } else {
            const dataUrl = cropper.getCroppedCanvas().toDataURL('image/png');
            // 将图片中的可能的透明色转换为白色
            const img = document.createElement('img');
            img.src = dataUrl;
            img.addEventListener('load', () => {
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;

              // 在canvas绘制前填充白色背景
              const context = canvas.getContext('2d');

              context.fillStyle = '#fff';
              context.fillRect(0, 0, canvas.width, canvas.height);

              context.drawImage(img, 0, 0);

              resolve(canvas.toDataURL('image/jpeg'));
            });
          }
        }).then((dataURL: string) => {
          return new Promise((resolve, reject) => {
            this.chatRoomService.sendPicture(dataURL.split(',')[1])
              .then(() => resolve())
              .catch(error => reject(this.msg.getMessage('E004', '图片发送')));
          });
        });
      },
    }).then(() => {
      // 释放资源
      URL.revokeObjectURL(url);
    }, () => {
      // 取消按钮被按下
      // 释放资源
      URL.revokeObjectURL(url);
    });
  }

  /**
   * 将消息框内容滚动至最下方
   */
  private scrollToBottom() {
    setTimeout(() => {
      const scrollPanel = $('.msg-container-base');
      scrollPanel.animate({ scrollTop: scrollPanel[0].scrollHeight, speed: 'fast' });
    });
  }

  /**
   * 设置消息容器高度
   */
  private setHeight() {
    const panelHeading = $('.panel-heading');
    const panelFooter = $('.panel-footer');

    const height = window.innerHeight
      - (+panelHeading[0].offsetTop)
      - (+panelHeading[0].clientHeight)
      - (+panelFooter[0].clientHeight) - 50;

    $('.msg-container-base').height(height);
  }
}
