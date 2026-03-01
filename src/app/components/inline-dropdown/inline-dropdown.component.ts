import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, OnDestroy, Output } from '@angular/core';

export interface InlineDropdownItem {
  value: number;
  label: string;
}

export interface InlineDropdownAction {
  id: string;
  title: string;
  ariaLabel: string;
  icon: 'plus' | 'trash';
  variant?: 'default' | 'danger';
  disabled?: boolean;
}

@Component({
  selector: 'app-inline-dropdown',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './inline-dropdown.component.html',
  styleUrl: './inline-dropdown.component.scss'
})
export class InlineDropdownComponent implements OnDestroy {
  private static nextId = 0;
  private static openInstance: InlineDropdownComponent | null = null;

  @Input() items: InlineDropdownItem[] = [];
  @Input() selectedValue: number | null = null;
  @Input() placeholder = 'Select option';
  @Input() stackedPanel = false;
  @Input() disabled = false;
  @Input() actions: InlineDropdownAction[] = [];

  @Output() selectionChange = new EventEmitter<number>();
  @Output() actionSelected = new EventEmitter<string>();

  readonly panelId = `inline-dropdown-panel-${++InlineDropdownComponent.nextId}`;
  open = false;

  get selectedLabel(): string {
    if (this.selectedValue == null) {
      return this.placeholder;
    }

    return this.items.find((item) => item.value === this.selectedValue)?.label ?? this.placeholder;
  }

  get isPlaceholder(): boolean {
    return this.selectedValue == null;
  }

  toggle(): void {
    if (this.disabled) {
      return;
    }

    if (this.open) {
      this.close();
      return;
    }

    InlineDropdownComponent.openInstance?.close();
    InlineDropdownComponent.openInstance = this;
    this.open = true;
  }

  select(value: number): void {
    this.selectionChange.emit(value);
    this.close();
  }

  triggerAction(actionId: string): void {
    this.actionSelected.emit(actionId);
    this.close();
  }

  close(): void {
    this.open = false;
    if (InlineDropdownComponent.openInstance === this) {
      InlineDropdownComponent.openInstance = null;
    }
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.close();
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    this.close();
  }

  ngOnDestroy(): void {
    this.close();
  }
}
