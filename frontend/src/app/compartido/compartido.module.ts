import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';
import { BarraSuperiorComponent } from './barra-superior.component';
import { CargandoComponent } from './cargando.component';
import { ChipsAlergenosComponent } from './chips-alergenos.component';
import { EtiquetaLimpiarDirective } from './etiqueta-limpiar.directive';

/** Componentes que usan todas las páginas. */
@NgModule({
  imports: [CommonModule, IonicModule, RouterModule],
  declarations: [BarraSuperiorComponent, CargandoComponent, ChipsAlergenosComponent, EtiquetaLimpiarDirective],
  exports: [BarraSuperiorComponent, CargandoComponent, ChipsAlergenosComponent, EtiquetaLimpiarDirective],
})
export class CompartidoModule {}
