
ALTER TABLE public.orcamentos
  ADD CONSTRAINT orcamentos_cliente_id_fkey
  FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE SET NULL;

ALTER TABLE public.orcamento_itens
  ADD CONSTRAINT orcamento_itens_procedimento_id_fkey
  FOREIGN KEY (procedimento_id) REFERENCES public.procedimentos(id) ON DELETE SET NULL;
;
