import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular/lazy';
import { BusquedaPage } from './busqueda.page';
import { BusquedaPageRoutingModule } from './busqueda-routing.module';
import { CompartidoModule } from '../compartido/compartido.module';

@NgModule({
  imports: [CommonModule, IonicModule, CompartidoModule, BusquedaPageRoutingModule],
  declarations: [BusquedaPage],
})
export class BusquedaPageModule {}
