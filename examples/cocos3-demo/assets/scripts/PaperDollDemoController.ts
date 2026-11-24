import { _decorator, Color, Component, EventKeyboard, input, Input, KeyCode, Node, Vec3 } from 'cc';

const { ccclass, property } = _decorator;

/**
 * PaperDollKit v2.0 — Cocos Creator 3.x Turnkey Interactive Demo Controller
 *
 * Attach this script to your Canvas/World node and drag the exported
 * `PaperDollModular` node into the `dollNode` inspector slot.
 *
 * Controls:
 *   W / A / S / D : Move & auto-update 8-dir isometric facing + walk/idle
 *   Space / J     : Play attack clip
 *   K             : Play cast clip
 *   C             : Cycle primary armor palette (cobalt / crimson / emerald / gold)
 *   H             : Trigger hit-flash shader uniform
 */
@ccclass('PaperDollDemoController')
export class PaperDollDemoController extends Component {
  @property(Node)
  dollNode: Node | null = null;

  @property
  moveSpeed = 180;

  private keys = new Set<KeyCode>();
  private palettes = ['cobalt', 'crimson', 'emerald', 'gold', 'violet'];
  private paletteIdx = 0;

  onEnable() {
    input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
    this.dollNode?.on('paperdoll-event', this.onPaperDollEvent, this);
  }

  onDisable() {
    input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
    this.dollNode?.off('paperdoll-event', this.onPaperDollEvent, this);
  }

  private getModularComp(): Record<string, (...args: unknown[]) => void> | null {
    if (!this.dollNode) return null;
    return this.dollNode.getComponent('PaperDollModular') as unknown as Record<
      string,
      (...args: unknown[]) => void
    > | null;
  }

  private onKeyDown(e: EventKeyboard) {
    this.keys.add(e.keyCode);
    const doll = this.getModularComp();
    if (!doll) return;

    if (e.keyCode === KeyCode.SPACE || e.keyCode === KeyCode.KEY_J) {
      doll.playAction?.('attack', true);
    } else if (e.keyCode === KeyCode.KEY_K) {
      doll.playAction?.('cast', true);
    } else if (e.keyCode === KeyCode.KEY_H) {
      doll.triggerHitFlash?.(Color.WHITE, 0.16);
    } else if (e.keyCode === KeyCode.KEY_C) {
      this.paletteIdx = (this.paletteIdx + 1) % this.palettes.length;
      const pal = this.palettes[this.paletteIdx]!;
      doll.setPalette?.('torso_top', pal);
      doll.setPalette?.('back_cloak', pal);
      doll.setPalette?.('front_arm', pal);
    }
  }

  private onKeyUp(e: EventKeyboard) {
    this.keys.delete(e.keyCode);
  }

  update(dt: number) {
    if (!this.dollNode) return;
    const vx = (this.keys.has(KeyCode.KEY_D) ? 1 : 0) - (this.keys.has(KeyCode.KEY_A) ? 1 : 0);
    const vy = (this.keys.has(KeyCode.KEY_W) ? 1 : 0) - (this.keys.has(KeyCode.KEY_S) ? 1 : 0);

    const doll = this.getModularComp();
    if (vx !== 0 || vy !== 0) {
      const len = Math.hypot(vx, vy) || 1;
      const pos = this.dollNode.position;
      this.dollNode.setPosition(
        new Vec3(pos.x + (vx / len) * this.moveSpeed * dt, pos.y + (vy / len) * this.moveSpeed * 0.65 * dt, pos.z),
      );
      doll?.playAction?.('walk');
    } else {
      doll?.playAction?.('idle');
    }
  }

  private onPaperDollEvent(eventName: string, arg?: string) {
    console.log(`[PaperDollKit] Animation Event: ${eventName} (${arg ?? ''})`);
  }
}
