import { Package, Cylinder, Container } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@shared/components/ui/tabs";
import ProdutosTab from "@chemflow/components/cadastro/ProdutosTab";
import IsotanquesTab from "@chemflow/components/cadastro/IsotanquesTab";
import VasilhamesTab from "@chemflow/components/cadastro/VasilhamesTab";

const TAB_TRIGGER_CLASS =
  "gap-2 px-5 py-2.5 text-sm font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md";

export default function Cadastro() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Cadastros</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Gerencie produtos, isotanques e vasilhames cadastrados no sistema
        </p>
      </div>

      <Tabs defaultValue="produto">
        <TabsList className="h-auto p-1.5 gap-1 bg-muted/80 border border-border shadow-sm">
          <TabsTrigger value="produto" className={TAB_TRIGGER_CLASS}>
            <Package className="w-4 h-4" />
            Produto
          </TabsTrigger>
          <TabsTrigger value="isotanque" className={TAB_TRIGGER_CLASS}>
            <Cylinder className="w-4 h-4" />
            Isotanque
          </TabsTrigger>
          <TabsTrigger value="vasilhame" className={TAB_TRIGGER_CLASS}>
            <Container className="w-4 h-4" />
            Vasilhame
          </TabsTrigger>
        </TabsList>
        <TabsContent value="produto" className="mt-6">
          <ProdutosTab />
        </TabsContent>
        <TabsContent value="isotanque" className="mt-6">
          <IsotanquesTab />
        </TabsContent>
        <TabsContent value="vasilhame" className="mt-6">
          <VasilhamesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
