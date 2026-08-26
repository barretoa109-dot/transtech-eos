-- EOS — que la vitrina diga de quién son las facturas
--
-- El módulo se llama "Factura electrónica" y su descripción no aclaraba lo más
-- importante: las facturas son **del usuario**, no de TransTech.
--
-- TransTech factura a sus clientes a través del producto de facturación
-- electrónica que contrató a Bancard, que emite automáticamente con su timbrado
-- por los cobros que pasan por la pasarela. Este módulo es otra cosa: le sirve
-- al usuario de EOS para facturarle a SUS clientes, con su propio RUC, su
-- timbrado y su certificado.
--
-- Que la descripción no lo diga invita justo al malentendido caro: alguien
-- contrata el módulo esperando que EOS le emita sus facturas como se las emiten
-- a él. Ver `docs/facturacion-quien-emite-que.md`.

update public.eos_modulos
set descripcion =
      'Comprobantes de TUS ventas, con numeración y código de control. ' ||
      'La firma digital y el envío a SIFEN se habilitan cuando tengas tu ' ||
      'certificado y tu RUC habilitado por la SET.'
where codigo = 'facturacion';
