import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular/lazy';
import { AvisoSinConexionComponent } from './aviso-sin-conexion.component';

/** Piezas de la PWA que usa AppComponent (el aviso sin conexión). */
@NgModule({
  imports: [CommonModule, IonicModule],
  declarations: [AvisoSinConexionComponent],
  exports: [AvisoSinConexionComponent],
})
export class PwaModule {}
