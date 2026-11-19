import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';
import { BarraSuperiorComponent } from './barra-superior.component';

/** Componentes que usan todas las páginas. */
@NgModule({
  imports: [CommonModule, IonicModule, RouterModule],
  declarations: [BarraSuperiorComponent],
  exports: [BarraSuperiorComponent],
})
export class CompartidoModule {}
