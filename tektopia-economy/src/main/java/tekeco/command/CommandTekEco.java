package tekeco.command;

import java.util.Collections;
import java.util.List;
import javax.annotation.Nullable;
import net.minecraft.command.CommandBase;
import net.minecraft.command.CommandException;
import net.minecraft.command.ICommandSender;
import net.minecraft.command.WrongUsageException;
import net.minecraft.entity.player.EntityPlayerMP;
import net.minecraft.init.Items;
import net.minecraft.item.ItemStack;
import net.minecraft.server.MinecraftServer;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.text.TextComponentTranslation;
import net.minecraft.world.World;
import net.minecraftforge.items.ItemHandlerHelper;
import net.tangotek.tektopia.Village;
import net.tangotek.tektopia.entities.EntityVillagerTek;
import tekeco.EcoConfig;
import tekeco.payroll.Payroll;
import tekeco.payroll.Villages;
import tekeco.treasury.Treasury;
import tekeco.treasury.TreasuryData;
import tekeco.wallet.IWallet;
import tekeco.wallet.WalletCapability;

/** /tekeco balance | deposit <amount|all> | withdraw <amount> | report, for the village you're standing in. */
public class CommandTekEco extends CommandBase {

    @Override
    public String getName() {
        return "tekeco";
    }

    @Override
    public String getUsage(ICommandSender sender) {
        return "commands.tekeco.usage";
    }

    @Override
    public int getRequiredPermissionLevel() {
        return 0;
    }

    @Override
    public boolean checkPermission(MinecraftServer server, ICommandSender sender) {
        return true;
    }

    @Override
    public void execute(MinecraftServer server, ICommandSender sender, String[] args) throws CommandException {
        if (args.length < 1) {
            throw new WrongUsageException(getUsage(sender));
        }
        EntityPlayerMP player = getCommandSenderAsPlayer(sender);
        World world = player.world;
        Village village = Villages.at(world, player.getPosition());
        Treasury treasury = Villages.treasury(world, village);
        if (treasury == null) {
            throw new CommandException(village == null ? "commands.tekeco.novillage" : "commands.tekeco.notownhall");
        }

        switch (args[0]) {
            case "balance":
                sender.sendMessage(new TextComponentTranslation("commands.tekeco.balance", village.getName(), treasury.getBalance()));
                break;
            case "deposit":
                deposit(player, village, treasury, args);
                break;
            case "withdraw":
                withdraw(server, player, village, treasury, args);
                break;
            case "report":
                report(player, village, treasury);
                break;
            default:
                throw new WrongUsageException(getUsage(sender));
        }
    }

    private void deposit(EntityPlayerMP player, Village village, Treasury treasury, String[] args) throws CommandException {
        if (args.length < 2) {
            throw new WrongUsageException("commands.tekeco.deposit.usage");
        }
        int held = player.inventory.clearMatchingItems(Items.EMERALD, -1, 0, null);
        int amount = "all".equals(args[1]) ? held : parseInt(args[1], 1);
        if (amount <= 0 || amount > held) {
            throw new CommandException("commands.tekeco.deposit.notenough", held);
        }
        int removed = player.inventory.clearMatchingItems(Items.EMERALD, -1, amount, null);
        player.inventoryContainer.detectAndSendChanges();
        treasury.deposit(removed);
        TreasuryData.get(player.world).markDirty();
        player.sendMessage(new TextComponentTranslation("commands.tekeco.deposit.done", removed, village.getName(), treasury.getBalance()));
    }

    private void withdraw(MinecraftServer server, EntityPlayerMP player, Village village, Treasury treasury, String[] args) throws CommandException {
        if (args.length < 2) {
            throw new WrongUsageException("commands.tekeco.withdraw.usage");
        }
        if (EcoConfig.withdrawRequiresOp && !player.canUseCommand(2, getName())) {
            throw new CommandException("commands.tekeco.withdraw.oponly");
        }
        int amount = parseInt(args[1], 1);
        if (!treasury.withdraw(amount)) {
            throw new CommandException("commands.tekeco.withdraw.notenough", treasury.getBalance());
        }
        TreasuryData.get(player.world).markDirty();
        int maxStack = Items.EMERALD.getItemStackLimit();
        for (int left = amount; left > 0; left -= maxStack) {
            ItemHandlerHelper.giveItemToPlayer(player, new ItemStack(Items.EMERALD, Math.min(left, maxStack)));
        }
        player.sendMessage(new TextComponentTranslation("commands.tekeco.withdraw.done", amount, village.getName(), treasury.getBalance()));
    }

    private void report(EntityPlayerMP player, Village village, Treasury treasury) {
        World world = player.world;
        int residents = 0;
        int savings = 0;
        for (EntityVillagerTek v : world.getEntities(EntityVillagerTek.class, v -> v != null && v.isEntityAlive() && v.getVillage() == village)) {
            IWallet wallet = WalletCapability.get(v);
            if (wallet != null) {
                residents++;
                savings += wallet.getCoins();
            }
        }
        player.sendMessage(new TextComponentTranslation("commands.tekeco.report.header", village.getName()));
        player.sendMessage(new TextComponentTranslation("commands.tekeco.report.balance", treasury.getBalance()));
        player.sendMessage(new TextComponentTranslation("commands.tekeco.report.savings", savings, residents));
        if (treasury.getStatsDay() < 0) {
            player.sendMessage(new TextComponentTranslation("commands.tekeco.report.nopayday"));
        } else {
            long daysAgo = Payroll.payday(world) - treasury.getStatsDay();
            player.sendMessage(new TextComponentTranslation("commands.tekeco.report.payday", daysAgo,
                treasury.getWagesPaid(), treasury.getVillagersPaid(), treasury.getUpkeepCollected(),
                treasury.getVillagersUnpaid(), treasury.getVillagersBroke()));
        }
    }

    @Override
    public List<String> getTabCompletions(MinecraftServer server, ICommandSender sender, String[] args, @Nullable BlockPos targetPos) {
        if (args.length == 1) {
            return getListOfStringsMatchingLastWord(args, "balance", "deposit", "withdraw", "report");
        }
        if (args.length == 2 && "deposit".equals(args[0])) {
            return getListOfStringsMatchingLastWord(args, "all");
        }
        return Collections.emptyList();
    }
}
